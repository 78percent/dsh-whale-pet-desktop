param(
    [ValidateSet('codex', 'claude')][string]$Source,
    [string]$ConnectionFile
)

# Observer only: stdout/stderr stay empty and every path exits successfully.
# stdin must be decoded to obtain metadata; prompts, arguments, transcripts,
# credentials and response text are never inspected, logged, or transmitted.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

function Get-Id([object]$Value) {
    if ($Value -is [string] -and $Value.Length -gt 0 -and $Value.Length -le 200) { return $Value }
    return $null
}

function Get-ToolIntent([string]$ToolName) {
    if (-not $ToolName) { return 'WORKING' }
    $name = $ToolName.ToLowerInvariant()
    switch -Regex ($name) {
        '(^|[._])(?:apply_patch|write|edit|multiedit|notebookedit|bash|powershell|pwsh|exec_command|write_stdin|str_replace_editor)$' { return 'CODING' }
        '(^|[._])(?:read|read_file|read_image|view_image|glob|grep|list_directory|list_resources|read_mcp_resource)$' { return 'READING' }
        '(^|[._])(?:web_search|web_fetch|websearch|webfetch|search_query|browse)$' { return 'RESEARCHING' }
        default { return 'WORKING' }
    }
}

try {
    if (-not $Source -or -not $ConnectionFile -or -not [System.IO.File]::Exists($ConnectionFile)) { exit 0 }
    $connection = [System.IO.File]::ReadAllText($ConnectionFile) | ConvertFrom-Json
    $address = [Uri]$connection.endpoint
    if ($address.Scheme -ne 'http' -or $address.Host -ne '127.0.0.1' -or
        $address.AbsolutePath -ne '/events' -or $address.UserInfo -or $address.Query -or
        -not ($connection.token -is [string]) -or -not $connection.token) { exit 0 }

    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $sessionId = Get-Id $payload.session_id
    if (-not $sessionId) { exit 0 }
    $agentId = Get-Id $payload.agent_id
    if ($agentId) {
        if ($Source -eq 'codex') { $sessionId = $agentId }
        else { $sessionId = "${sessionId}::agent:${agentId}" }
    }
    $turnId = Get-Id $payload.turn_id
    if (-not $turnId) { $turnId = Get-Id $payload.prompt_id }
    $toolId = Get-Id $payload.tool_use_id
    $eventName = $payload.hook_event_name
    $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $events = [System.Collections.Generic.List[object]]::new()
    $baseEvent = @{ source = $Source; sessionId = $sessionId; at = $at; client = 'unknown' }
    if ($Source -eq 'claude') { $baseEvent.client = 'cli' }
    if ($turnId) { $baseEvent.turnId = $turnId }
    if ($toolId) { $baseEvent.toolId = $toolId }

    function Add-Event([string]$Kind, [string]$Intent) {
        $event = $baseEvent.Clone()
        $event.kind = $Kind
        if ($Intent) { $event.intent = $Intent }
        # Tool calls and turn completion have stable identities. Model retries,
        # notifications, and session resumes are independent occurrences.
        if (($toolId -and $Kind -in @('tool_start', 'tool_end', 'error')) -or
            ($turnId -and $Kind -in @('done', 'interrupt'))) {
            $event.eventId = "${eventName}:${turnId}:${toolId}:${Kind}"
        } else {
            $event.eventId = [Guid]::NewGuid().ToString('N')
        }
        $events.Add($event)
    }

    switch ($eventName) {
        'SessionStart' { Add-Event 'session_start' $null }
        'UserPromptSubmit' { Add-Event 'prompt' 'WORKING' }
        'PreModelRequest' { Add-Event 'model_start' 'WORKING' }
        'PostModelRequest' {
            Add-Event 'model_end' $null
            if ($payload.status -eq 'failed') { Add-Event 'error' 'ERROR' }
        }
        'PreToolUse' { Add-Event 'tool_start' (Get-ToolIntent $payload.tool_name) }
        'PostToolUse' {
            Add-Event 'tool_end' $null
            # Read only an explicit machine error flag, never output text.
            if ($payload.tool_response -is [pscustomobject] -and
                ($payload.tool_response.isError -eq $true -or $payload.tool_response.is_error -eq $true)) {
                Add-Event 'error' 'ERROR'
            }
        }
        'PostToolUseFailure' {
            Add-Event 'tool_end' $null
            if ($payload.is_interrupt -ne $true) { Add-Event 'error' 'ERROR' }
        }
        'PermissionRequest' { Add-Event 'waiting' 'WAITING_USER' }
        'Notification' {
            if ($payload.notification_type -in @('permission_prompt', 'elicitation_dialog',
                'elicitation_url_dialog', 'agent_needs_input', 'quota_auto_resume_stale')) {
                Add-Event 'waiting' 'WAITING_USER'
            }
        }
        'SubagentStart' {
            if ($agentId) {
                # The parent turn id is not the child's turn id. This marker
                # spans the child's lifetime and is closed by SubagentStop.
                $baseEvent.Remove('turnId')
                Add-Event 'session_start' $null
                Add-Event 'prompt' 'WORKING'
            }
        }
        'SubagentStop' {
            if ($agentId) { Add-Event 'session_end' $null }
        }
        'Stop' { Add-Event 'done' $null }
        'StopFailure' { Add-Event 'error' 'ERROR'; Add-Event 'done' $null }
        'Interrupt' { Add-Event 'interrupt' $null }
        'SessionEnd' { Add-Event 'session_end' $null }
    }

    foreach ($event in $events) {
        $request = $null
        $response = $null
        $stream = $null
        try {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes(($event | ConvertTo-Json -Compress -Depth 4))
            $request = [System.Net.HttpWebRequest]::Create($address)
            $request.Method = 'POST'
            $request.ContentType = 'application/json; charset=utf-8'
            $request.Headers['Authorization'] = 'Bearer ' + $connection.token
            $request.Proxy = $null
            $request.AllowAutoRedirect = $false
            $request.KeepAlive = $false
            $request.Timeout = 450
            $request.ReadWriteTimeout = 450
            $request.ContentLength = $bytes.Length
            $stream = $request.GetRequestStream()
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Dispose()
            $stream = $null
            $response = $request.GetResponse()
        } catch {
            # The desktop may be closed. Observing it must not affect the agent.
            break
        } finally {
            if ($stream) { $stream.Dispose() }
            if ($response) { $response.Dispose() }
            if ($request) { $request.Abort() }
        }
    }
} catch {
    # Never print hook decisions, model context, payloads, or connection secrets.
}
exit 0

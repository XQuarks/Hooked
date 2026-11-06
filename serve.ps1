param([int]$Port = 8765, [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$webRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$serviceName = 'hook-to-the-sky-web'
$listener = $null
for ($candidatePort = $Port; $candidatePort -lt $Port + 10; $candidatePort++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$candidatePort/__health" -TimeoutSec 1
        if ($health.service -eq $serviceName -and $health.root -eq $webRoot) {
            if ($OpenBrowser) { Start-Process "http://127.0.0.1:$candidatePort/" }
            Write-Output "Already serving http://127.0.0.1:$candidatePort/"
            exit 0
        }
    } catch { }
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidatePort)
        $listener.Start()
        $Port = $candidatePort
        break
    } catch { $listener = $null }
}
if ($null -eq $listener) { throw 'No free local port between 8765 and 8774.' }
[System.IO.File]::WriteAllText((Join-Path $webRoot '.server.pid'), [string]$PID)
[System.IO.File]::WriteAllText((Join-Path $webRoot '.server.url'), "http://127.0.0.1:$Port/")
Write-Output "Serving http://127.0.0.1:$Port/"
if ($OpenBrowser) { Start-Process "http://127.0.0.1:$Port/" }
$mimeTypes = @{ '.html'='text/html; charset=utf-8'; '.js'='application/javascript'; '.wasm'='application/wasm'; '.pck'='application/octet-stream'; '.png'='image/png'; '.ico'='image/x-icon'; '.json'='application/json; charset=utf-8' }
try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 30000
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue }
            $parts = $requestLine.Split(' ')
            if ($parts.Count -lt 2) { continue }
            while ($reader.ReadLine()) { }
            $method = $parts[0]
            $requestPath = [System.Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
            $status = '200 OK'
            $contentType = 'text/plain; charset=utf-8'
            $fileStream = $null
            $body = [byte[]]@()
            if ($requestPath -eq '/__health') {
                $contentType = 'application/json; charset=utf-8'
                $body = [System.Text.Encoding]::UTF8.GetBytes((@{service=$serviceName;root=$webRoot} | ConvertTo-Json -Compress))
            } else {
                if ($requestPath -eq '/') { $requestPath = '/index.html' }
                $filePath = [System.IO.Path]::GetFullPath((Join-Path $webRoot $requestPath.TrimStart('/')))
                $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
                $insideRoot = $filePath.StartsWith($webRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
                if ($insideRoot -and $mimeTypes.ContainsKey($extension) -and [System.IO.File]::Exists($filePath)) {
                    $contentType = $mimeTypes[$extension]
                    $fileStream = [System.IO.File]::OpenRead($filePath)
                } else {
                    $status = '404 Not Found'
                    $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
                }
            }
            $length = if ($null -ne $fileStream) { $fileStream.Length } else { $body.Length }
            $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $length`r`nCache-Control: no-cache`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -ne 'HEAD') {
                if ($null -ne $fileStream) { $fileStream.CopyTo($stream) }
                else { $stream.Write($body, 0, $body.Length) }
            }
            if ($null -ne $fileStream) { $fileStream.Dispose() }
            $stream.Flush()
        } catch { Write-Output $_.Exception.Message }
        finally { $client.Dispose() }
    }
} finally { $listener.Stop() }

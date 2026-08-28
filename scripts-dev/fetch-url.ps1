# Fetch a web page and extract readable text (follows 301/302/307/308 redirects)
# 抓取网页并抽取可读文本（跟随重定向；自动解压 gzip/deflate）
param([Parameter(Mandatory=$true)][string]$Url, [int]$MaxChars = 12000)
$ErrorActionPreference = 'Stop'
Write-Host ("URL_PARAM=[" + $Url + "] MAX=" + $MaxChars)
$current = $Url
for ($i = 0; $i -lt 8; $i++) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($current)
    $req.AllowAutoRedirect = $false
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    $req.Timeout = 25000
    $req.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    if ($code -ge 300 -and $code -lt 400) {
      $loc = $resp.Headers['Location']
      $resp.Close()
      if (-not $loc) { break }
      $current = [System.Uri]::new([System.Uri]$current, $loc).AbsoluteUri
      continue
    }
    $sr = [System.IO.StreamReader]::new($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $html = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
    $html = $html -replace '(?s)<(script|style|noscript)[^>]*>.*?</\1>', ' '
    $title = ''
    $m = [regex]::Match($html, '(?s)<title[^>]*>(.*?)</title>')
    if ($m.Success) { $title = $m.Groups[1].Value.Trim() }
    $text = [regex]::Replace($html, '(?s)<[^>]+>', ' ')
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    $text = ([regex]::Replace($text, '\s+', ' ')).Trim()
    if ($text.Length -gt $MaxChars) { $text = $text.Substring(0, $MaxChars) + ' ...[TRUNC]' }
    'URL: ' + $current
    'TITLE: ' + $title
    '---'
    $text
    exit 0
  } catch [System.Net.WebException] {
    $wr = $_.Exception.Response
    if ($wr) {
      $code = [int]$wr.StatusCode
      if ($code -ge 300 -and $code -lt 400) {
        $loc = $wr.Headers['Location']
        $wr.Close()
        if ($loc) { $current = [System.Uri]::new([System.Uri]$current, $loc).AbsoluteUri; continue }
      }
      'HTTP_ERROR ' + $code + ' ' + $current; exit 1
    }
    'FETCH_ERROR: ' + $_.Exception.Message; exit 1
  }
}
'REDIRECT_LOOP'; exit 1

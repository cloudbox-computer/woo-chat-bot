$anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhizgdfcqqktxoqlbazpsIn0.5KvM3rNl6Vx8Z9yJQ2wP1oE4tR7sA6bC8dF0gH2iJ4kL"
$email = "test@test.com"
$password = "Test1234!"
$outFile = "C:\Users\mazwi\Desktop\chatbot-system\test-out.txt"
"" | Out-File $outFile

try {
  $authUrl = "https://xsegdfcqqktxoqlbazpl.supabase.co/auth/v1/token?grant_type=password"
  $body = @{email=$email;password=$password} | ConvertTo-Json
  $headers = @{"Content-Type"="application/json";"apikey"=$anon}
  $resp = Invoke-RestMethod -Uri $authUrl -Method POST -Headers $headers -Body $body
  $token = $resp.access_token
  "Auth OK token_len=$($token.Length)" | Out-File $outFile -Append

  $h2 = @{"Authorization"="Bearer $token";"apikey"=$anon;"Content-Type"="application/json"}

  # listTenants
  try {
    $r = Invoke-WebRequest -Uri "https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/dashboard?action=tenants" -Method GET -Headers $h2 -ErrorAction Stop
    "listTenants status=$($r.StatusCode)" | Out-File $outFile -Append
    $r.Content | Out-File $outFile -Append
  } catch {
    "listTenants ERROR: $($_.Exception.Message)" | Out-File $outFile -Append
    if ($_.Exception.Response) {
      $s = $_.Exception.Response.GetResponseStream()
      $rd = New-Object System.IO.StreamReader($s)
      $rd.ReadToEnd() | Out-File $outFile -Append
    }
  }
  "" | Out-File $outFile -Append

  # createTenant
  try {
    $createBody = @{name="ZTest"+(Get-Random -Maximum 9999)} | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/dashboard?action=tenants" -Method POST -Headers $h2 -Body $createBody -ErrorAction Stop
    "createTenant status=$($r.StatusCode)" | Out-File $outFile -Append
    $r.Content | Out-File $outFile -Append
  } catch {
    "createTenant ERROR: $($_.Exception.Message)" | Out-File $outFile -Append
    if ($_.Exception.Response) {
      $s = $_.Exception.Response.GetResponseStream()
      $rd = New-Object System.IO.StreamReader($s)
      $rd.ReadToEnd() | Out-File $outFile -Append
    }
  }
} catch {
  "Auth failed: $($_.Exception.Message)" | Out-File $outFile -Append
}
"Done" | Out-File $outFile -Append

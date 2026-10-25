# Puts Noodle's email templates and subjects into the Supabase project in one go.
#
# Needs a Supabase personal access token (supabase.com/dashboard/account/tokens).
# The token stays on this computer: the script only sends it to Supabase.
#
#   powershell -ExecutionPolicy Bypass -File supabase\apply-emails.ps1
#
# Custom SMTP must be switched on first, or Supabase ignores the templates.

$project = "rvkpswyezcmkdtrixcrp"
$base = "https://raw.githubusercontent.com/abhaysingh1122/noodle/main/supabase/email"
$bowl = [char]::ConvertFromUtf32(0x1F35C)

$token = Read-Host "Paste your Supabase access token (starts with sbp_)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($token))

# Supabase's name for each email => (file, subject)
$emails = [ordered]@{
  confirmation      = @("confirm-signup", "Your Noodle bowl is almost ready $bowl")
  magic_link        = @("magic-link", "Your Noodle sign-in link")
  recovery          = @("reset-password", "Reset your Noodle password")
  email_change      = @("change-email", "Confirm your new email for Noodle")
  invite            = @("invite", "You're invited to Noodle")
  reauthentication  = @("reauthentication", "Your Noodle code")
}

$config = @{}
foreach ($name in $emails.Keys) {
  $file, $subject = $emails[$name]
  Write-Host "Fetching $file.html"
  $html = (Invoke-WebRequest -UseBasicParsing "$base/$file.html").Content
  $config["mailer_subjects_$name"] = $subject
  $config["mailer_templates_${name}_content"] = $html
}

$body = [Text.Encoding]::UTF8.GetBytes(($config | ConvertTo-Json -Depth 3))
Invoke-RestMethod -Method Patch -Uri "https://api.supabase.com/v1/projects/$project/config/auth" `
  -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json; charset=utf-8" -Body $body | Out-Null
Write-Host "Done. All six emails are in place." -ForegroundColor Green

# Confirmation email template

Use `confirmation.html` as a Supabase Auth confirmation-email template with the subject **Confirm your Shedmo email** and sender display name **Shedmo**.

Both links use Supabase's `{{ .ConfirmationURL }}`. Configure the environment's Site URL and mobile redirect allowlist consistently with the existing authentication callbacks. The template does not introduce a custom token or callback flow.

The HTML template does not control the From header. Configure sender branding and a verified sender address through your own SMTP provider and Supabase Auth settings. Keep SMTP credentials in backend configuration. Validate delivered links and the mobile redirect flow in a separate development environment before release.

See the Supabase Auth documentation for SMTP and email-template configuration.

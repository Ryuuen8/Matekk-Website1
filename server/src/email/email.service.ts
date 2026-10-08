import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type UserStatus = 'pending' | 'accepted' | 'rejected';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    constructor(private config: ConfigService) { }

    private getRequiredConfig(key: string): string {
        const value = this.config.get<string>(key)?.trim();

        if (!value) {
            throw new InternalServerErrorException(`Missing required config: ${key}`);
        }

        return value;
    }

    private async callEmailJs(templateId: string, templateParams: Record<string, string>) {
        const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                service_id: this.getRequiredConfig('EMAILJS_SERVICE_ID'),
                template_id: templateId,
                user_id: this.getRequiredConfig('EMAILJS_PUBLIC_KEY'),
                accessToken: this.getRequiredConfig('EMAILJS_PRIVATE_KEY'),
                template_params: templateParams,
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            // Details stay in the server logs only, never in the API response
            this.logger.error(
                `EmailJS request failed with status ${res.status}. Response: ${errorText}`,
            );
            throw new InternalServerErrorException('Could not send email');
        }
    }

    async sendUserStatusEmail(user: { name: string; email: string }, status: UserStatus) {
        const content: Record<UserStatus, { title: string; body: string }> = {
            pending: {
                title: 'Thanks for registering!',
                body: 'Your request is pending approval. This usually takes 24-48 hours.',
            },
            accepted: {
                title: 'Account approved!',
                body: 'Great news — your account has been approved. You can now log in.',
            },
            rejected: {
                title: 'Registration update',
                body: 'Unfortunately we were unable to approve your registration at this time.',
            },
        };

        await this.callEmailJs(this.getRequiredConfig('EMAILJS_USER_TEMPLATE_ID'), {
            email: user.email,
            name: user.name,
            to_name: user.name,
            to_email: user.email,
            email_title: content[status].title,
            email_body: content[status].body,
            from_name: 'Matekk Cybercore',
            sender_name: 'Matekk Cybercore',
        });
    }

    async sendAdminNotification(applicant: { name: string; email: string }) {
        const frontendUrl = this.getRequiredConfig('FRONTEND_URL');
        const adminEmail = this.getRequiredConfig('ADMIN_EMAIL');

        await this.callEmailJs(this.getRequiredConfig('EMAILJS_ADMIN_TEMPLATE_ID'), {
            email: adminEmail,
            to_name: 'Matekk Admin',
            to_email: adminEmail,
            applicant_name: applicant.name,
            applicant_email: applicant.email,
            submitted_at: new Date().toLocaleString(),
            review_url: `${frontendUrl}/admin/requests`,
            from_name: 'Matekk Cybercore',
        });
    }

    /**
     * Sends the OTP through the user template.
     * The template must use {{{email_body}}} (triple braces) so the code box renders as HTML.
     * Only HTML built here is passed in; never put user-supplied text into email_body.
     */
    async sendOtp(email: string, code: string, expiresInMinutes: number) {
        // Defensive: the code must be exactly 6 digits before it goes into HTML
        if (!/^\d{6}$/.test(code)) {
            throw new InternalServerErrorException('Could not send email');
        }

        const emailBody =
            `Use this code to continue:` +
            `<div style="margin:20px 0;padding:20px;background-color:#eff6ff;border:1px solid #bfdbfe;` +
            `border-radius:12px;text-align:center;font-family:Menlo,Consolas,monospace;` +
            `font-size:36px;font-weight:700;letter-spacing:10px;color:#0b0f1a;">${code}</div>` +
            `It expires in <strong>${expiresInMinutes} minutes</strong> and can only be used once. ` +
            `If you didn't request it, you can ignore this email.`;

        await this.callEmailJs(this.getRequiredConfig('EMAILJS_USER_TEMPLATE_ID'), {
            email,
            to_email: email,
            to_name: 'there',
            email_title: 'Your verification code',
            email_body: emailBody,
            from_name: 'Matekk Cybercore',
            sender_name: 'Matekk Cybercore',
        });
    }
}
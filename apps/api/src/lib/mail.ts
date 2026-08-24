import nodemailer from "nodemailer";
import { env } from "./env.js";

let _transport: nodemailer.Transporter | null = null;

export function transporter(): nodemailer.Transporter {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: false,
  });
  return _transport;
}

export async function sendMail(opts: { to: string; subject: string; text?: string; html?: string }) {
  try {
    await transporter().sendMail({ from: env.MAIL_FROM, ...opts });
    return true;
  } catch (e) {
    console.error("[mail] send failed", (e as Error).message);
    return false;
  }
}

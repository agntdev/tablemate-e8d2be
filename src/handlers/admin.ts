import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { claimOrCheckOwner, dashboard, displayDateTime, markNoShow } from "../reservation-domain.js";

registerMainMenuItem({ label: "Owner dashboard", data: "admin:dashboard", order: 90 });
const composer = new Composer<Ctx>();
async function showDashboard(ctx: Ctx, edit: boolean): Promise<void> {
  if (!(await claimOrCheckOwner(ctx))) { const text = "This dashboard is only available to the restaurant owner."; if (edit) await ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); else await ctx.reply(text); return; }
  const view = await dashboard(ctx);
  const calendar = view.upcoming.length ? view.upcoming.map((booking) => `${displayDateTime(booking)} · ${booking.partySize} guests · ${booking.referenceCode}`).join("\n") : "No bookings in the next 7 days.";
  const text = `Today has ${view.todayCovers} covers and ${view.remaining} places remaining.\n\nNext 7 days:\n${calendar}`;
  const rows = view.upcoming.slice(0, 5).flatMap((booking) => [[inlineButton(`No-show ${booking.referenceCode}`, `admin:no_show:${booking.id}`)], [inlineButton(`Cancel ${booking.referenceCode}`, `admin:cancel:${booking.id}`)]]);
  rows.push([inlineButton("Refresh", "admin:dashboard")], [inlineButton("Back to menu", "menu:main")]);
  if (edit) await ctx.editMessageText(text, { reply_markup: inlineKeyboard(rows) }); else await ctx.reply(text, { reply_markup: inlineKeyboard(rows) });
}
composer.command("admin", async (ctx) => { await showDashboard(ctx, false); });
composer.callbackQuery("admin:dashboard", async (ctx) => { await ctx.answerCallbackQuery(); await showDashboard(ctx, true); });
composer.callbackQuery(/^admin:no_show:b\d+$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await claimOrCheckOwner(ctx))) { await ctx.editMessageText("This dashboard is only available to the restaurant owner."); return; } const booking = await markNoShow(ctx, ctx.callbackQuery.data.slice("admin:no_show:".length)); await ctx.editMessageText(booking ? `Marked ${booking.referenceCode} as a no-show.` : "That booking is already closed.", { reply_markup: inlineKeyboard([[inlineButton("Back to dashboard", "admin:dashboard")]]) }); });
composer.callbackQuery(/^admin:cancel:b\d+$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await claimOrCheckOwner(ctx))) { await ctx.editMessageText("This dashboard is only available to the restaurant owner."); return; } const { cancelBookingAsOwner } = await import("../reservation-domain.js"); const booking = await cancelBookingAsOwner(ctx, ctx.callbackQuery.data.slice("admin:cancel:".length)); await ctx.editMessageText(booking ? `Cancelled ${booking.referenceCode}.` : "That booking is already closed.", { reply_markup: inlineKeyboard([[inlineButton("Back to dashboard", "admin:dashboard")]]) }); });
export default composer;

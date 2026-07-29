import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { claimOrCheckOwner, dashboard } from "../reservation-domain.js";

const composer = new Composer<Ctx>();
/** Compatibility callback from the published owner surface; it lists real bookings, never a fake selection. */
composer.callbackQuery("admin:no_show", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await claimOrCheckOwner(ctx))) { await ctx.editMessageText("This dashboard is only available to the restaurant owner."); return; }
  const upcoming = (await dashboard(ctx)).upcoming;
  await ctx.editMessageText(upcoming.length ? "Choose the reservation that didn’t arrive." : "There are no upcoming bookings to mark.", { reply_markup: inlineKeyboard(upcoming.length ? [...upcoming.map((booking) => [inlineButton(`${booking.datetime.slice(0, 10)} ${booking.datetime.slice(11, 16)} · ${booking.referenceCode}`, `admin:no_show:${booking.id}`)]), [inlineButton("Back to dashboard", "admin:dashboard")]] : [[inlineButton("Back to dashboard", "admin:dashboard")]]) });
});
export default composer;

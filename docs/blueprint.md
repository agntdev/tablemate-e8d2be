# Restaurant Reservation Bot — Bot specification

**Archetype:** booking

**Voice:** friendly and professional — write every user-facing message, button label, error, and empty state in this voice.

Telegram bot for restaurant table reservations with real-time availability checks, confirmation codes, and automated reminders. Guests can reschedule/cancel via buttons, while owners monitor bookings, track capacity, and flag no-shows through a private admin view.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- restaurant guests
- restaurant owners/managers

## Success criteria

- Displays only genuinely available time slots based on table inventory and rules
- Sends confirmation codes and reminders to guests
- Provides owner with real-time booking dashboard and capacity tracking

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open guest booking menu
- **/admin** (command, actor: owner, command: /admin) — Open owner dashboard
- **Reschedule** (button, actor: user, callback: booking:reschedule) — Initiate rescheduling flow
- **Cancel** (button, actor: user, callback: booking:cancel) — Cancel reservation
- **Mark No-Show** (button, actor: owner, callback: admin:no_show) — Flag booking as no-show

## Flows

### Guest Booking
_Trigger:_ /start

1. Date picker selection
2. Display available time slots with labels (Exact fit/Combined tables)
3. Party size selection
4. Optional guest info collection
5. Confirmation with reference code and buttons

_Data touched:_ Table, Sitting, Venue rules

### Rescheduling
_Trigger:_ booking:reschedule

1. Show available slots for new date/time
2. Update booking with new details
3. Send new confirmation code

_Data touched:_ Sitting

### Owner Dashboard
_Trigger:_ /admin

1. Display 7-day booking calendar
2. Show today's capacity summary
3. Allow no-show marking/editing bookings

_Data touched:_ Sitting, Table

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Table** _(retention: persistent)_ — Restaurant table inventory
  - fields: id, seats, count
- **Sitting** _(retention: persistent)_ — Reservation records
  - fields: guest name (optional), phone (optional), party size, datetime, duration, assigned tables, reference code, status
- **Venue rules** _(retention: persistent)_ — Operational constraints
  - fields: opening hours by weekday, sitting duration, buffer times, max simultaneous covers

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- View upcoming bookings (7-day window)
- Edit/cancel reservations
- Mark no-shows
- View today's remaining capacity

## Notifications

- Guest reminders 2 hours before reservations
- Owner notifications for new bookings and no-shows

## Permissions & privacy

- Guest data (name/phone) only shared with owner
- No third-party data sharing
- Bookings stored securely with owner access controls

## Edge cases

- Overlapping bookings due to buffer time changes
- No available slots for requested date/time
- Guest cancels after reminder was sent

## Required tests

- End-to-end booking flow with availability checks
- Admin dashboard accuracy after multiple bookings
- Reminder message delivery timing

## Assumptions

- Default opening hours: weekdays 11:00-22:00, weekends 10:00-23:00
- Default table inventory: 3×2-seat, 5×4-seat, 1×6-seat
- Default 90-minute sitting duration with 10-minute buffer

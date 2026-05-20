# CHRONOS GMT — assistant notes

## Media storage

Store all original media the user sends that contains booking or reservation information.

- Destination: `docs/bookings/` at the project root.
- Keep the original files (PDFs, images, screenshots). Do not re-encode or summarize them in place of the original.
- Naming convention: `YYYY-MM-DD_<ROUTE-or-SHORT-ID>_<VENDOR-REF>.<ext>`.
  - Flights: `YYYY-MM-DD_FROM-TO_Carrier-FlightNo_vendor-bookingref.pdf` (e.g. `2026-04-29_DPS-SIN_Scoot-TR283_kiwi-762610772.pdf`).
  - Hotels/rentals: `YYYY-MM-DD_<CITY>_<PROPERTY>_<vendor-ref>.<ext>`.
- When adding the corresponding entry to `config.json` (`upcomingTrips`, `bookings`, `alerts`, `longTermBookings`), include the vendor reference in a `bookingRef` field when available and reference the stored file path in `attachments`.
- Do not delete stored media when entries are superseded; move outdated files to `docs/bookings/archive/` instead.

## One-time bookings vs Renewals

Use `bookings` only for one-time reservations: flights, hotels, short stays, fixed-date transport, and other non-renewing confirmations. One-time bookings do not create renewal alerts.

Use `longTermBookings` for recurring or ongoing commitments that should appear in the Renewals tab and feed dashboard alerts:

- monthly rent / housing
- motorbike rental
- gym memberships
- coworking/workspace
- SIM/mobile plans
- visa status

For renewing items, set `startDate` to the latest start/renewal date and `renewDate` to the next due date. The app derives active dashboard alerts from `longTermBookings` with a valid `renewDate`; do not duplicate those same renewals under `alerts`. Visa status also belongs in `longTermBookings`; leave `renewDate` null until the expiry/extension date is known.

## Flights must be recorded in both `upcomingTrips` and `bookings`

Every flight is recorded twice in `config.json`: once in `upcomingTrips` (which feeds the dashboard alerts panel) and once in `bookings` (the canonical bookings list).

- IDs follow sequence: `trip-NNN` in `upcomingTrips`, `booking-NNN` in `bookings`. They do not have to share the same number — just keep each sequence contiguous.
- The two entries for the same flight must agree on: date, times, airline, flight number, airports, cities, countries, duration, `bookingRef`, and `attachments`.
- `bookings.notes` for mirrored flights: `"Imported from upcoming trips."`.
- `upcomingTrips` uses the richer schema (`departureDate/Time`, `arrivalDate/Time`, `departureAirportName`, `arrivalAirportName`, `departureCountry`, `arrivalCountry`). `bookings` uses the flatter schema (`startDate`, `departureTime`, `arrivalTime`, `departureCity`, `arrivalCity`, `departureAirport`, `arrivalAirport`, `title: "From → To"`) but should also include `departureCountry`, `arrivalCountry`, and `arrivalDate` so flight bookings can update travel-log-derived stats even if only booking data is read.
- When a flight is added, updated, or cancelled, update both entries in the same edit. Never leave one side out of sync.
- Flight country changes feed the dashboard travel stats. Keep `travelLog` and `travelTimeline` aligned with flight border crossings when making manual config edits. The app also derives missing travel-log stays from `upcomingTrips`/flight `bookings` at runtime, so future flight additions with `departureCountry` and `arrivalCountry` automatically count toward total stay, current stay, country-day totals, and fiscal/travel stats.

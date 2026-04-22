# CHRONOS GMT — assistant notes

## Media storage

Store all original media the user sends that contains booking or reservation information.

- Destination: `docs/bookings/` at the project root.
- Keep the original files (PDFs, images, screenshots). Do not re-encode or summarize them in place of the original.
- Naming convention: `YYYY-MM-DD_<ROUTE-or-SHORT-ID>_<VENDOR-REF>.<ext>`.
  - Flights: `YYYY-MM-DD_FROM-TO_Carrier-FlightNo_vendor-bookingref.pdf` (e.g. `2026-04-29_DPS-SIN_Scoot-TR283_kiwi-762610772.pdf`).
  - Hotels/rentals: `YYYY-MM-DD_<CITY>_<PROPERTY>_<vendor-ref>.<ext>`.
- When adding the corresponding entry to `config.json` (`upcomingTrips`, `bookings`, `alerts`), include the vendor reference in a `bookingRef` field and reference the stored file path in `attachments`.
- Do not delete stored media when entries are superseded; move outdated files to `docs/bookings/archive/` instead.

## Flights must be recorded in both `upcomingTrips` and `bookings`

Every flight is recorded twice in `config.json`: once in `upcomingTrips` (which feeds the dashboard alerts panel) and once in `bookings` (the canonical bookings list).

- IDs follow sequence: `trip-NNN` in `upcomingTrips`, `booking-NNN` in `bookings`. They do not have to share the same number — just keep each sequence contiguous.
- The two entries for the same flight must agree on: date, times, airline, flight number, airports, cities, duration, `bookingRef`, and `attachments`.
- `bookings.notes` for mirrored flights: `"Imported from upcoming trips."`.
- `upcomingTrips` uses the richer schema (`departureDate/Time`, `arrivalDate/Time`, `departureAirportName`, `arrivalAirportName`, `departureCountry`, `arrivalCountry`). `bookings` uses the flatter schema (`startDate`, `departureTime`, `arrivalTime`, `departureCity`, `arrivalCity`, `departureAirport`, `arrivalAirport`, `title: "From → To"`).
- When a flight is added, updated, or cancelled, update both entries in the same edit. Never leave one side out of sync.

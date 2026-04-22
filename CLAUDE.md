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

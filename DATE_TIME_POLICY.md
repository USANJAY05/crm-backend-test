# Date/time policy

- Application timestamps are stored as ISO-8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`) in the current MySQL schema.
- Scheduler/retry comparisons use the same ISO UTC string as the bound cutoff; they do not compare UTC `NOW()` against text timestamps or parse timestamps with `STR_TO_DATE`. ISO UTC strings sort chronologically when consistently formatted.
- Caller-local wall-clock times are converted to UTC before persistence by the timezone-aware follow-up agent.
- Business/local greetings use `Intl.DateTimeFormat` with an explicit IANA timezone; fixed numeric offsets are not used.
- Do not use `new Date()` on a timezone-less caller wall-clock string. Convert it with the caller's IANA timezone first.
- Future schema migrations may move timestamp columns to `DATETIME(3)`, but that should be a deliberate migration with explicit read/write conversion and a data backfill, not an implicit type change.

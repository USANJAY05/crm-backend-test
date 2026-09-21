# SQL Injection / Query Parameter Audit

## Scope
Audited the MySQL adapter, shared pool, repository raw SQL, and query-builder surface.

## Result
Values are sent through mysql2 bound parameters. Dynamic identifiers are now validated against the known `TABLES` schema before interpolation.

Protected identifier surfaces:
- query-builder table names
- filter columns (`eq`, `neq`, `is`, `in`, `gt`, `gte`, `lte`, `ilike`, `not`, `filter`)
- `order()` columns
- `textSearch()` columns
- `.or()` expression fields
- selected base columns

The application uses fixed internal table names for raw repository SQL. Dynamic SQL table/column names used by schema initialization come from the static schema definition rather than request data.

## Regression cases
The adapter now rejects attempts such as:
- `id OR 1=1`
- `id; DROP TABLE users`
- `id, (SELECT ...)`
- `id DESC` supplied as a column identifier
- `.or("id.eq.x,id) OR 1=1.eq.y")`

Values such as `x' OR 1=1 --` remain ordinary bound parameters.

A live MySQL injection test should still be run as part of the Docker/MySQL 8.4 integration suite.

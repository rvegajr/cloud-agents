# Design

<!-- The blueprint, written by the architect in stage 1. Every exported symbol the
     crew will implement is named here with its signature and error behaviour; if
     the crew has to choose a signature, this file is incomplete. For a change or
     repair, this is a delta: only what is new or altered, existing modules
     referenced by path. See PATTERN.md section 2.3. -->

## Layout

```
<path>        <what it exports> — <one sentence of responsibility>
```

## Ports (one per consumer — interface segregation)

### <PortName>   used by: <consumers>
```
method(arg: Type): ReturnType     throws <Error> on <condition>; returns null on not-found
```

## Wiring

`createApp(deps)` (or this stack's equivalent): every adapter passed in; tests
pass fakes. No module opens a database, file, or socket at import time.

## Data model

```
<Entity> { field: type, … }
```

## API contract (or CLI contract)

```
METHOD /path          <status> <shape> | <error status> {error}
any other /api/*      404 {"error":"not found"}   (JSON, never HTML)
Error envelope:       { "error": "<one sentence>" }
```

For a CLI: every flag, exit code, and output format.

## Existing code (change / repair / maintain only)

- `<path>` — kept as is; <what depends on it>.
- Defect location (repair): `<path>:<line>` — <what is wrong>; invariant the fix
  must not break: <…>.
- Migration steps (maintain): <ordered list, each with the file it touches>.

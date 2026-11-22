# CardDAV-Synchronisierung ohne Schreibzugriffe untersuchen

Der separate Einstiegspunkt `api/dist/diagnoseSync.js` startet weder HTTP-API,
Bootstrap, Migrationen noch Cron/Sync. Die bestehende API bleibt gestoppt.
**Für die erste Untersuchung ausschließlich diesen Einstiegspunkt verwenden.**
Die Instrumentierung im normalen Sync ist für spätere freigegebene Läufe gedacht;
der normale Sync bleibt schreibend.

## Vorbereitung in einem separaten Checkout

Den Draft-Branch `diagnose/carddav-read-only` separat auschecken. Nicht den
Produktiv-Checkout ersetzen und keine Compose-Dienste starten. Mit Node 22:

```sh
npm ci --ignore-scripts
npm run build --workspace=api
npm test
```

Die Tests verwenden synthetische Daten, gemockte Transporte und eine isolierte
In-Memory-Datenbank. Keine Produktivdaten oder produktiven Migrationen werden
angesprochen. Für das Diagnoseprogramm werden keine nativen Addon-Builds benötigt.

Eine geschützte Datei außerhalb des Repositories anlegen (Modus 0600), etwa
`/secure/frigg-diagnose.env`. Sie enthält ausschließlich:

```dotenv
DATABASE_URL=<bestehende PostgreSQL-Verbindung im gewählten Netzwerk>
CREDENTIALS_ENCRYPTION_KEY=<bestehender Schlüssel zum Lesen der gespeicherten DAV-Zugangsdaten>
SYNC_DIAGNOSTICS_KEY=<neuer zufälliger Schlüssel: 64 Hex-Zeichen>
```

Keine Beispielwerte wörtlich übernehmen. Die ersten beiden Werte aus der
bestehenden geschützten Installation übernehmen, nicht in Terminalausgaben,
Tickets oder Shell-History kopieren. Der Diagnose-Schlüssel muss unabhängig vom
Credential-Schlüssel erzeugt werden. Eine Datei nur für den neuen Schlüssel lässt
sich ohne Ausgabe des Geheimnisses erzeugen:

```sh
umask 077
node -e 'require("node:fs").writeFileSync("/secure/frigg-diagnose-key.env", "SYNC_DIAGNOSTICS_KEY=" + require("node:crypto").randomBytes(32).toString("hex") + "\n", {mode: 0o600, flag: "wx"})'
```

Diese Zeile mit einem geschützten Editor in die Diagnose-Env-Datei übernehmen.
Nicht den bestehenden Verschlüsselungsschlüssel ersetzen. Fehlender/ungültiger
Diagnose-Schlüssel oder Wiederverwendung des Credential-Schlüssels verhindert den
Diagnosestart vor jeder Verbindung. Schlüssel behalten, solange zwei Läufe über
Referenzen verglichen werden sollen; danach geschützt löschen.

## Einmaliger Lauf auf der bestehenden Installation

Wenn PostgreSQL vom Diagnosehost erreichbar ist:

```sh
umask 077
node --env-file=/secure/frigg-diagnose.env api/dist/diagnoseSync.js > /secure/frigg-diagnose.jsonl
```

Bei der bestehenden Docker-Installation ist `db` normalerweise nur im internen
Compose-Netz erreichbar. Dann einen **separaten kurzlebigen Node-Container** an das
bereits vorhandene Netzwerk hängen. Den konkreten Netzwerknamen aus der lokalen
Docker-Konfiguration übernehmen; nicht `docker compose up` oder den API-Service
starten. Aus dem separat gebauten Diagnose-Checkout:

```sh
umask 077
FRIGG_DIAG_NETWORK='<vorhandenes internes Netzwerk>'
docker run --rm --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --network "$FRIGG_DIAG_NETWORK" \
  --env-file /secure/frigg-diagnose.env \
  --mount "type=bind,src=$PWD/api/dist,dst=/app/api/dist,readonly" \
  --mount "type=bind,src=$PWD/node_modules,dst=/app/node_modules,readonly" \
  --entrypoint node node:22-alpine \
  /app/api/dist/diagnoseSync.js > /secure/frigg-diagnose.jsonl
```

Dies baut/publiziert kein Frigg-Image und ersetzt keinen Dienst. Es benötigt Zugriff
auf den vorhandenen PostgreSQL-Server und Baïkal. Keine Debug-/HTTP-Trace-Variablen
oder Node-Inspector aktivieren. Die Env-Datei ist keine Logdatei und darf nicht
geteilt werden.

Exitcodes: **0** = Leseprüfungen ohne Befund, **2** = Ressourcen-/Kontofehler,
**1** = Start-/Datenbank-/Programmabbruch. Ein Exitcode 0 beweist nicht, dass ein
späterer schreibender Sync fehlerfrei wäre.

## Garantien und Grenzen

- Eigener PostgreSQL-Pool mit `default_transaction_read_only=on`; zusätzlich eine
  dedizierte `REPEATABLE READ READ ONLY`-Transaktion, Abschluss immer per ROLLBACK.
  Die einzigen Datenabfragen sind SELECT auf `carddav_accounts`, `addressbooks`
  und `contacts`. Keine Upserts, DELETEs, Markerupdates oder Migrationen.
- Der DAV-Transport lässt nur GET, HEAD, OPTIONS, PROPFIND und REPORT zu. PUT,
  DELETE, MOVE, COPY, POST, PROPPATCH usw. werden vor dem Transport blockiert;
  automatische Redirects sind abgeschaltet. Keine Remote-Schreiboperationen.
- Discovery und native vCard-Lesung entsprechen dem Sync. Der Lesemodus untersucht
  anschließend jede Ressource einzeln und setzt nach Ressourcenfehlern fort.
  Er ignoriert CTag-/Sync-Token-Skip-Entscheidungen und ausstehende Kontaktoperationen,
  weil er ausschließlich liest. Dadurch können mehr Befunde als im abgebrochenen
  normalen Sync sichtbar werden.
- UID/Href-Schutzbedingung, globaler Href-Konflikt und projizierte NULL-UID werden
  ohne INSERT geprüft. Frühere erfolgreiche Prüfungen werden nur im Speicher
  berücksichtigt. `eligible_resources` sind **keine erfolgreichen Schreibvorgänge**.
  Constraints/Trigger, Schreibberechtigungen und Fehler erst beim Schreiben lassen
  sich so nicht vollständig nachweisen. Deren SQLSTATE wird bei einem später
  autorisierten normalen Sync datensparsam erfasst.
- Datenbankzustand stammt aus einem konsistenten Snapshot; Baïkal kann sich während
  der Prüfung ändern. Der Lauf rekonstruiert nicht sicher den historischen Zustand
  der neun Fehler. Er ordnet aktuell reproduzierbare Befunde Ressourcenreferenzen zu.

## Ausgabe auswerten

```sh
jq 'select(.type == "book_summary")' /secure/frigg-diagnose.jsonl
jq 'select(.type == "failure") | {book_ref,resource_ref,phase,reason,code}' /secure/frigg-diagnose.jsonl
```

Pro Adressbuch enthält `book_summary`:

- `listed_resources`: Anzahl Hrefs in der Liste; `null`, wenn keine Liste verfügbar
  war oder das normale Sync-Buch übersprungen wurde. Im Delta-Sync nur Änderungen.
- `successful_upserts`: tatsächlich erfolgreiche normale Sync-Upserts, auch vor
  einem späteren Abbruch. Im Lesemodus immer **0**.
- `eligible_resources`: im Lesemodus bestandene Prüfungen; im normalen Sync 0.
- `errors_by_category`: Diagnoseereignisse nach Ursache. Diese sind nicht identisch
  mit dem bisherigen `errors`-Zähler: etwa ein Delta-Fehler plus Full-Sync-Fallback
  kann zusätzliche Ereignisse erzeugen. Prozess-/Kontofehler außerhalb der
  Buchzusammenfassung nicht nochmals zu deren Summen addieren.
- `markers`: `unchanged`, `advanced` oder `write_failed`. Im Lesemodus immer
  **unchanged**. `write_failed` bedeutet fehlende Schreibbestätigung; bei einem
  Verbindungsabbruch kann ein serverseitiger Commit nicht ausgeschlossen werden.

| reason | Bedeutung / nächster Schritt |
| --- | --- |
| `document_parse_failed` | Eigener Parser; `code` unterscheidet `invalid_vcard`, `unsupported_vcard_version`, `invalid_uid`. Betroffene Karte geschützt lokal prüfen. |
| `vcf_parse_failed` | Sekundärer vcf-Parser lehnt ab; mit synthetischer Reproduktion eingrenzen. Keine rohe Fehlermeldung teilen. |
| `uid_href_conflict` | Gleiche UID im Buch, aber geschützte Href-Zuordnung passt nicht. Nicht automatisch überschreiben. |
| `href_unique_conflict` | Lesemodus erkennt bereits belegten Href bei anderem Datensatz. |
| `projected_uid_null` | UID vorhanden, aber Projektion liefert NULL, etwa wegen Encoding/Charset. |
| `missing_resource` | Native Lesung liefert 404/NULL; Ressource möglicherweise während des Laufs entfernt. |
| `invalid_resource` / `multiget_incomplete` | Fehlende Daten/URL oder unvollständige/fehlerhafte DAV-Antwort. |
| `dav_exception` | Freigegebener DAV-Code, z.B. `native_vcard_unavailable` oder `valid_etag_required`. |
| `database_exception` | Freigegebener SQLSTATE, z.B. `23505` (unique), `23502` (not null), `08006` (Verbindung). |
| `pending_operation` | Normaler Sync überspringt das Buch wegen offener Operation. |
| `unexpected_exception` | Bewusst ohne rohe Fehlermeldung; anhand der Phase weiter eingrenzen. |

`book_ref` und `resource_ref` sind HMAC-SHA-256-Pseudonyme, keine URLs oder UIDs.
Sie bleiben mit demselben Schlüssel stabil. Für die geschützte lokale Zuordnung:
`book_ref = HMAC(key, "book\0" + bookUrl)` und
`resource_ref = HMAC(key, "resource\0" + bookUrl + "\0" + absoluteHref)`.
Der Hex-Schlüssel wird vorher in Bytes dekodiert. Ein berechtigter Administrator
kann vorhandene URLs ausschließlich lokal damit vergleichen; keine Zuordnungsliste
mit echten URLs in Diagnose-Logs aufnehmen. Auch pseudonymisierte Logs geschützt
behandeln und nur die benötigten Befunde teilen.

Im normalen Sync ohne gültigen `SYNC_DIAGNOSTICS_KEY` bleiben Entscheidungen und
Rückgabewerte unverändert: Ereignisse enthalten keine Referenzen und melden
`references_enabled: false`. Es gibt keinen ungesalzenen Hash-Fallback. Der separate
Lesemodus verlangt hingegen einen gültigen Schlüssel. Roh-vCards, Namen, UIDs,
URLs, ETags, Sync-Token, CTags, Credentials, SQL-Details und ungefilterte Exceptions
werden vom Diagnosecode nicht ausgegeben.

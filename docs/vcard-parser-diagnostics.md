# Gezielte Korrektur der neun Leerzeilen-Ablehnungen

Nachgewiesener Lesebefund: 122 Ressourcen in drei Adressbüchern, davon 113
akzeptiert und neun ausschließlich mit `document_parse_failed` / `invalid_vcard` /
`empty_line` abgelehnt (5/2/2). Andere Fehlerkategorien wurden nicht beobachtet.

`readDocument()` entfaltet weiterhin zuerst die physischen Zeilen und überspringt
anschließend ausschließlich tatsächlich leere logische Zeilen (`unfolded === ''`).
Kein `trim()`, keine Entfernung physischer Leerzeilen vor der Faltung: Andernfalls
könnte eine Fortsetzung einer falschen Property zugeordnet werden. Genau ein
Faltungs-Space/Tab wird entfernt; weitere Leerzeichen bleiben Inhalt. `NOTE:` und
andere leere Property-Werte bleiben Properties. Roh-vCards bleiben beim Lesen und
bei unveränderten Patches unverändert; bei tatsächlichen lokalen Dokumentedits
werden ignorierte Leerzeilen nicht serialisiert, unveränderte Content-Lines samt
Faltung und Leerzeichen bleiben erhalten.

Regulärer Full-/Delta-Sync und separater Lesemodus verwenden dieselbe Korrektur über
`parseVCard()` → `projectDocument()` → `readDocument()`. Übrige Struktur-, Versions-,
UID- und Konfliktprüfungen sowie Schreibsperren und Diagnosefunktionen bleiben
unverändert. Synthetische Regressionstests bilden die Verteilung 5/2/2 nach und
verlangen nun 122 bestandene Prüfungen, null Fehler, null Upserts und unveränderte
Marker. Das ist noch kein erneuter Lauf gegen die produktiven Ressourcen.

## Verarbeitung vor dem Fehler

1. Der Lesemodus listet Ressourcen mit REPORT und liest jede native Darstellung
   mit PROPFIND (`carddav.ts`, `withNativeCards().readVCard`). Fehlende/nicht-string
   Daten und fehlender/ungültiger ETag werden schon dort separat geprüft.
2. `tsdav` decodiert die XML-Antwort über `xml-js` mit `trim: true`. Synthetische
   Tests mit dem echten installierten `tsdav.propfind` (gemockter Fetch, ohne Netz)
   zeigen für CDATA und Text: äußere Leerzeichen, BOM und äußere Leerzeilen werden
   entfernt. Innere Leerzeilen und innere alleinstehende CR bleiben erhalten.
   Diese Bibliotheksbehandlung besteht bereits; der Patch fügt keine hinzu.
3. Friggs Adapter reicht `addressData._cdata ?? addressData` als String weiter.
   `parseVCard()` ruft zuerst `projectDocument()` / `readDocument()` auf.
   `splitVCards()` gehört zum Dateiimport und wird hier nicht benutzt.
4. Erst nach erfolgreicher Projektion folgt `VCF.parse()` mit den akzeptierten Content-Lines samt originaler Faltung
   und CRLF-Zeilentrennern. So lehnt auch der sekundäre Check keine führenden
   leeren logischen Zeilen ab; die gespeicherte Roh-vCard bleibt unverändert. Eine dortige Exception hätte
   `reason: vcf_parse_failed`, nicht die hier beobachtete Fehlerkategorie.

Die Unterkategorie beschreibt den Parser-Eingabestring nach XML-Decoding, nicht
zwingend die Bytes in Baïkals Speicherung. Beispielsweise wäre ein äußeres BOM auf
dem getesteten XML-Pfad schon entfernt. `non_string_input` ist vollständig erfasst,
aber im regulären nativen Lesepfad bereits durch die vorgeschaltete Prüfung gesperrt.

## Sämtliche invalid_vcard-Bedingungen

Die Reihenfolge der verbleibenden Prüfungen entspricht dem bisherigen Parser: globale Eingabeprüfung,
Zeilenfaltung, sämtliche Content-Lines, anschließend Dokumentgrenzen. Es wird pro
Ressource nur die **erste** verletzte Bedingung erfasst, keine vollständige Liste
aller möglichen Defekte. Die Zusatzinformation lautet `subcategory`.

| Unterkategorie | Konkrete Bedingung |
| --- | --- |
| `non_string_input` | Eingabe ist kein JavaScript-String. |
| `nul_character` | Mindestens ein NUL-Zeichen irgendwo in der Eingabe. |
| `bare_cr` | Mindestens ein CR ohne unmittelbar folgendes LF; auch CR-only oder CRCRLF. |
| `orphan_fold` | Physische Zeile beginnt mit ASCII-Space/Tab, aber es gibt noch keine vorherige logische Zeile. |
| `empty_line` | Historische Kategorie, weiterhin allowlisted. Leere logische Zeilen werden jetzt toleriert; der Parser emittiert diese Kategorie nicht mehr. |
| `empty_property_name` | Erster nicht zitierter Doppelpunkt steht an Position 0. |
| `unclosed_header_quote` | Kein Trenn-Doppelpunkt außerhalb von Anführungszeichen gefunden und Quote-Zustand bleibt offen. Das ist eine lexikalische Diagnose, keine vollständige Parametervalidierung. |
| `missing_separator` | Kein nicht zitierter Doppelpunkt gefunden, Zeile nicht leer und Quote-Zustand geschlossen. Möglich bei unmarkierter Fortsetzung oder Legacy-Softbreak. |
| `leading_bom` | Qualified Property-Name der ersten logischen Zeile verletzt die Namensregel und beginnt mit U+FEFF. |
| `multiple_group_separators` | Ungültiger Qualified Property-Name enthält mehr als einen Punkt. |
| `invalid_group_name` | Genau ein Punkt vorhanden; davor leer oder andere Zeichen als ASCII-Buchstaben, Ziffern, Bindestrich. |
| `invalid_property_name` | Übrige Verletzung von `[Gruppe.]Name`: Property-Name leer oder mit unzulässigen Zeichen, z.B. Unterstrich, Space, NBSP, Nicht-ASCII. |
| `missing_begin` | Erste geparste Property ist nicht BEGIN, auch bei leerem Dokument. |
| `invalid_begin_value` | Erste Property ist BEGIN, deren Wert ist ohne Trimmen und unabhängig von Groß-/Kleinschreibung nicht VCARD. |
| `missing_end` | Letzte geparste Property ist nicht END. Auch eine zusätzliche Property nach END landet hier. |
| `invalid_end_value` | Letzte Property ist END, deren Wert ist ohne Trimmen und unabhängig von Groß-/Kleinschreibung nicht VCARD. |
| `boundary_count` | Anfang/Ende stimmen, aber insgesamt gibt es nicht genau zwei BEGIN-/END-Properties; z.B. verkettete Karten oder zusätzliche Grenzen. |

BOM-, Gruppen- und Property-Unterkategorien werden nur innerhalb der bereits
vorhandenen fehlgeschlagenen Namensprüfung bestimmt. Die Bedingungen werden nicht
strenger. Bei mehreren Namensdefekten gilt die Tabellenreihenfolge. Bei der
Delimiterprüfung wird vor dem ersten unzitierten Doppelpunkt jedes `"` wie bisher
als Umschalter behandelt; Inhalte werden weder protokolliert noch ausgegeben.

Andere Fehler bleiben getrennt: fehlende/mehrfache oder nicht unterstützte VERSION
führt zu `unsupported_vcard_version`; fehlende/mehrfache/leere UID zu `invalid_uid`.
Diese beiden Kategorien erklären die aktuell gemeldeten neun `invalid_vcard` nicht.

## Gültigkeit und Interoperabilität

- CRLF und Faltung durch CRLF plus genau ein Space oder Tab entsprechen
  [RFC 6350 §§3.2–3.3](https://www.rfc-editor.org/rfc/rfc6350.html#section-3.2).
  Der Parser akzeptiert diese bereits; auch Faltung in Namen/Parametern funktioniert.
  Bei zwei Spaces bleibt der zweite als Inhalt erhalten. LF-only, gemischte CRLF/LF,
  fehlender abschließender Zeilenumbruch und abschließende Leerzeilen werden ebenfalls
  schon toleriert. Lange ungefaltete Zeilen verursachen keine Ablehnung.
- Die ASCII-Namensregel mit optional einer Gruppe entspricht auch
  [RFC 2425 §5.8.2](https://www.rfc-editor.org/rfc/rfc2425.html#section-5.8.2).
  Unterstriche oder mehrere Gruppenpunkte sind keine nachgewiesen gültigen Namen.
  NBSP ist kein RFC-Faltungszeichen. Unmarkierte Base64-/Quoted-Printable-Fortsetzungen
  können von Legacy-Clients stammen; ihre Herkunft macht sie nicht automatisch zu
  gültiger vCard-3/4-Faltung. Regulär gefaltetes Base64 besteht den Test.
- Für die hier untersuchten strukturellen Regeln ist bisher keine Ablehnung einer
  synthetischen, standardkonformen einzelnen CardDAV-vCard nachgewiesen. Zwei
  verkettete Karten können zwar eine vCard-Datei bilden, sind aber keine einzelne
  CardDAV-Ressource: [RFC 6352 §5.1](https://www.rfc-editor.org/rfc/rfc6352.html#section-5.1)
  verlangt eine einzelne Komponente und eine UID.
- **Toleranzunterschied zu Sabre:** In
  [sabre/vobject 4.6.1, MimeDir](https://github.com/sabre-io/vobject/blob/4.6.1/lib/Parser/MimeDir.php)
  entfernt `parseDocument()` ein BOM und ergänzt bei EOF intern ein END;
  `readLine()` überspringt Leerzeilen. Frigg toleriert jetzt ebenfalls leere logische Zeilen; BOM- und END-Prüfungen bleiben strikt.
  Die Quelle ist auch im lokalen synthetischen Baïkal-Testpaket vorhanden.
  Das ist Codebefund, kein Test gegen die produktive Baïkal-Version und kein Beweis
  für sonstige Fehlerursachen. Der Sabre-CardDAV-Pfad validiert nach dem
  Lesen zusätzlich und kann je nach Handling Reparaturen vornehmen
  ([Plugin 4.7.1](https://github.com/sabre-io/dav/blob/4.7.1/lib/CardDAV/Plugin.php)).
  Akzeptanz durch einen toleranten Server ist nicht gleich RFC-Konformität.
- **Separater nachgewiesener Fehler im sekundären Parser:** Das installierte
  `vcf` zerlegt in `lib/vcard.js`, `vCard.parse()` am Text `BEGIN:VCARD`, ohne ihn
  auf eine Dokumentgrenze zu beschränken. Eine gültige Notiz mit diesem Text oder
  eine escaped eingebettete vCard-3-AGENT-Karte besteht `readDocument()`, scheitert
  aber danach. Das AGENT-Format ist in
  [RFC 2426 §3.5.4](https://www.rfc-editor.org/rfc/rfc2426.html#section-3.5.4) beschrieben.
  Die Tests halten diesen bestehenden Fehler ausdrücklich fest. Er ergibt
  `vcf_parse_failed`, kann also die neun gemeldeten Fehler nicht erklären und wird
  in diesem Leerzeilenpatch nicht korrigiert.

## Mit dem bestehenden Diagnosecontainer erneut lesen

Die API bleibt gestoppt. Nur den **separaten Diagnose-Checkout** auf den Folgecommit
des Branches `diagnose/carddav-read-only` aktualisieren und dessen Ausgabe neu bauen:

```sh
# Ausschließlich im separaten Diagnose-Checkout, nicht im Produktiv-Checkout:
git pull --ff-only origin diagnose/carddav-read-only
npm run build --workspace=api
test -f api/dist/vcardStructureError.js
```

Die bisherige geschützte Env-Datei inklusive **desselben** `SYNC_DIAGNOSTICS_KEY`
weiterverwenden, damit `book_ref` und `resource_ref` mit dem ersten Lauf vergleichbar
bleiben. Beim in [sync-diagnostics.md](sync-diagnostics.md) dokumentierten Container
wird `api/dist` read-only eingebunden: derselbe `docker run`-Befehl nutzt nach dem
Build automatisch den neuen Code. Ausschließlich `/app/api/dist/diagnoseSync.js`
starten und eine **neue** Logdatei verwenden, beispielsweise
`/secure/frigg-diagnose-empty-lines.jsonl`. Nicht `dist/index.js`, den API-Service,
normalen Sync oder Migrationen starten.

Falls der tatsächlich verwendete Diagnosecontainer die JS-Dateien im Image statt
als Bind-Mount enthält, reicht ein Neustart des alten Images nicht: zunächst die
neue Diagnose-Ausgabe separat einbinden, wie in der Anleitung beschrieben. Es ist
kein Austausch des produktiven Frigg-Images nötig.

Buchweise Summen einschließlich Unterkategorien:

```sh
jq 'select(.type == "book_summary") |
  {book_ref,listed_resources,eligible_resources,successful_upserts,
   errors_by_category,parser_errors_by_subcategory,markers}' \
  /secure/frigg-diagnose-empty-lines.jsonl
```

Eventuell verbleibende Ressourcen mit ihrer ersten strukturellen Ursache:

```sh
jq 'select(.type == "failure" and .reason == "document_parse_failed"
  and .code == "invalid_vcard") | {book_ref,resource_ref,subcategory}' \
  /secure/frigg-diagnose-empty-lines.jsonl
```

Gesamthäufigkeit pro Unterkategorie:

```sh
jq -s '[.[] | select(.type == "failure" and .reason == "document_parse_failed"
  and .code == "invalid_vcard")] | group_by(.subcategory) |
  map({subcategory: .[0].subcategory, count: length})' \
  /secure/frigg-diagnose-empty-lines.jsonl
```

Bei unverändertem Remote-Zustand ist das Ziel **122 gelistet / 122 akzeptiert / 0
Fehler**, sofern nach der Leerzeilenkorrektur keine weiteren Defekte sichtbar
werden. In allen drei Büchern müssen `successful_upserts: 0`, `markers: unchanged`,
`errors_by_category: {}` und `parser_errors_by_subcategory: {}` stehen; Prozess-
Exitcode 0. Ein erneutes `empty_line` deutet auf alte Diagnose-Artefakte hin.
Andere Fehler werden weiterhin nach ihrer ersten verletzten Bedingung klassifiziert,
insbesondere `invalid_uid`, `unsupported_vcard_version`, strukturelle Unterkategorien,
`vcf_parse_failed` und Konfliktkategorien. Ein vorher verdeckter Defekt ist separat
zu untersuchen; die Korrektur lockert dafür keine weiteren Prüfungen.

Es werden ausschließlich Enum-Werte ausgegeben, keine Zeilennummern,
Property-Namen, Zeilenausschnitte oder Werte. Keine Roh-vCards, Namen, Nummern,
E-Mails, UIDs, URLs, Credentials oder Tokens anfordern oder teilen.

Der Lauf ist hier nur vorbereitet. Kein Deployment, kein Start der produktiven API,
keine Migrationen, keine Änderungen an Baïkal oder produktiven Kontakten.

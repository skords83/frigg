# CardDAV-Datenintegrität: Analyse und PR-Aufteilung

Stand: 21.11.2026. Basis: `main` / `94ad5ef`. Arbeitsbaum zu Beginn sauber;
`origin/main` abgerufen und identisch. Keine offenen PRs laut `gh pr list`.
Keine produktiven Kontakte, Datenbanken oder CardDAV-Konten angesprochen.

## Architektur und Ausgangsbefunde

Next.js 15 / React 19, Express, PostgreSQL; `tsdav` für DAV und `vcf` für die
Kontaktprojektion. Tatsächlich installierte tsdav-Version: 2.3.0 (Lockfile).
Sessions, Kontozuordnung, Freigaben und verschlüsselte Zugangsdaten bleiben bestehen.
Manuelle Gruppen sind benutzergebunden in PostgreSQL; intelligente Gruppen liegen
im Browser-localStorage. Designreferenzen `web/PRODUCT.md` und `web/DESIGN.md` gelesen.
Keine neuen UI-Tokens, Frameworks oder Abhängigkeiten.

Geprüft: CardDAV-Adapter, Kontaktoperationen, Sync, Kontakt-/Gruppen-/Transfer-Routen,
Zugriffskontrolle, Migrationen 001–004, EditModal, DetailPane, ContactsApp,
DedupModal/dedup, Gruppen-Hooks, Build und vorhandener Workflow.
Es gab keine Tests und keinen PR-Testworkflow. Der vorhandene main-Workflow baut,
publiziert und deployt automatisch; er wurde nicht ausgelöst oder geändert.
API-Build und Web-Typecheck waren vor Änderungen erfolgreich.

Bestätigte Risiken:

- tsdav sendet HTTP-Preconditions, gibt aber bei Schreibfehlern Response-Objekte
  zurück. Frigg wertete deren Status nicht aus und schrieb trotzdem lokal weiter.
- Leere ETags ermöglichen unbedingte Schreibzugriffe; Fotoänderungen prüften die
  Version des bearbeitenden Clients nicht.
- Ressourcenadressen wurden aus UID geraten, obwohl `href` bereits gespeichert wird.
- Verschieben löschte die Quelle vor Erstellung des Ziels.
- Duplikat-„Merge“ bestand nur aus DELETE, ohne Feldübernahme oder Statusprüfung.
- Regex-Patches verlieren Parameter/zusätzliche Namensbestandteile; mehrwertige
  Eigenschaften werden vollständig ersetzt. Der Editor sendet auch unveränderte
  Felder. Import baut vCards neu und verliert nicht dargestellte Informationen.
- UID ist globaler Primärschlüssel, Gruppenmitgliedschaften referenzieren ihn.
  Sync konnte Kontakte zwischen Adressbüchern und Konten umhängen.
- Full Sync löschte auch bei Parsefehlern; CTag wurde vor erfolgreichem Sync
  gespeichert. Delta behandelte Ressourcen ohne `.vcf` nicht; parallele Läufe
  waren ungeschützt.

## PR 1: Sicherheits-Unterbau (dieser Draft)

- Zentraler Transport prüft Schreibbedingungen und Fehlerstatus. Fehlende,
  schwache, wildcard- oder Listen-ETags werden für Ersetzen/Löschen abgewiesen.
  Netzwerkfehler werden ohne Kontakt-/Zugangsdaten gemeldet; Timeout 30 Sekunden.
  Schreib-Redirects werden nicht automatisch verfolgt.
- PUT/Foto/DELETE verlangen `If-Match` und verwenden den gespeicherten href.
  Neue Kontakte speichern href und den Response-ETag. Fehlender Response-ETag
  wird nicht durch einen alten Wert ersetzt: weitere Bearbeitung benötigt Sync.
- Verschieben liest die Quelle, prüft deren Version, prüft UID-/Ressourcenkollisionen,
  erstellt bedingt, liest zurück, vergleicht UID und vollständigen Inhalt und
  löscht erst dann bedingt die Quelle. Unterschiede jenseits von Zeilenfaltung
  und Zeilenenden blockieren konservativ. Quelle und Ziel können andere Konten haben.
- Teilfehler hinterlassen vorhandene Kopien. Wiederholung überschreibt sie nicht;
  bei vorhandener Ziel-UID wird sicher abgebrochen. UI weist auf Prüfung beider
  Bücher hin. **Noch keine dauerhafte Operationshistorie/automatische Fortsetzung.**
- Destruktiver Schein-Merge ist mit deutscher Fehlermeldung vorläufig gesperrt.
  Erkennung und Vergleich bleiben verfügbar. Das ist eine bewusste temporäre
  Einschränkung, keine fertige Implementierung von Arbeitspaket C.
- Fehlerhafte Sync-Läufe bereinigen keine Löschungen und schreiben weder CTag
  noch Token fort. Fehlende UIDs werden nicht mehr zufällig ersetzt. UID-Kollisionen
  werden sicher abgewiesen. PostgreSQL-Advisory-Lock verhindert parallele Sync-Läufe.
- Neue Tests und separater CI-Workflow ohne Deployment-Berechtigungen.

## Abhängige Folge-PRs (vorgeschlagene Aufteilung)

1. **Ressourcenidentitäten und vCard-Modell (B, 8.1):** additive interne Kontakt-ID;
   alte UID und Gruppenreferenzen erhalten; neue Referenzen backfillen und prüfen,
   erst dann API/UI umstellen. Kein stilles Bereinigen von UID-Kollisionen.
   Parser-/Serializer-Vergleich mit synthetischen 3.0/4.0-Fixtures, anschließend
   verlustfreie gezielte Patches und Import. Unbekannte Parameter, gruppierte
   Properties, N/ORG/ADR-Komponenten, Foto, partielle Geburtstage, Escapes erhalten.
2. **Drei-Wege-Konfliktdialog (A):** Basisversion festhalten, aktuelle DAV-Version
   lesen, nur geänderte Felder auswählen; mit deren ETag erneut schreiben.
   Abbruch, externe Löschung und erneute Konflikte testen. Foto und Text dürfen
   nicht mehr als zwei unabhängige Benutzer-Speicheraktionen behandelt werden.
3. **Operationsprotokoll und echter Merge (C, D):** Vorschau aus beiden aktuellen
   Serverversionen; explizite Entscheidungen; unbekannte unvereinbare Eigenschaften
   blockieren. Dauerhaftes Journal vor erstem Schreibzugriff, Idempotenzschlüssel,
   Prüfsummen und Versionen; bedingtes Löschen erst nach Verifikation. Wiederaufnahme
   bei verlorener Antwort/DB-Ausfall und lokale Gruppenreferenzen erhalten.
4. **Synchronisierte Gruppen (E):** separate Ressourcen und Gruppentyp im UI;
   bestehende manuelle und intelligente Gruppen nicht umwandeln. KIND/MEMBER und
   Apple-X-Properties formatgetreu unterstützen; unbekannte Formate bewahren.
   Serverfähigkeiten und nicht auflösbare/mehrdeutige UID-Referenzen explizit prüfen.
   Isolierte Baïkal-Integration plus DAVx⁵/Android-Matrix.

Diese Aufteilung verhindert, dass eine globale Identitätsmigration, ein neues
vCard-Modell und alle Dialoge in einem schwer prüfbaren PR zusammenfallen.
Der Gesamtauftrag ist mit PR 1 ausdrücklich **nicht abgeschlossen**.

## Interoperabilitätsgrundlagen

- [RFC 9110, If-Match](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1):
  starke ETag-Vergleiche und serverseitige Schreibbedingungen.
- [RFC 6352, CardDAV](https://www.rfc-editor.org/rfc/rfc6352):
  Ressourcen/UID-Eindeutigkeit innerhalb eines Adressbuchs und bedingte Änderungen.
- [DAVx⁵: Baïkal](https://www.davx5.com/tested-with/baikal): separate Gruppen-vCards
  als Gruppenmethode (abzustimmen mit anderen Clients).
- [DAVx⁵ technische Dokumentation](https://manual.davx5.com/technical_information.html):
  getrennte Methoden CATEGORIES bzw. KIND/MEMBER; bei vCard 3 Apple-X-Properties.
- [DAVx⁵ Gruppen-FAQ](https://www.davx5.com/faq/cant-manage-groups-on-device):
  Fähigkeiten der Android-Kontakte-App sind separat zu prüfen.

Dokumentationsprüfung ist **kein** Baïkal-/DAVx⁵-Integrationsnachweis.
Kein Natel-Code übernommen; kein Lizenztransfer.

## Tests und Grenzen

- `npm test`: Transporttests inklusive lokaler HTTP-Server mit echter tsdav-Library;
  Move-Fehlermatrix und Sync-Regressionstests mit synthetischen Daten und
  vollständig ersetzten Datenbankzugriffen.
- `npm run build`: API- und Web-Produktionsbuild.
- `npx tsc --noEmit --incremental false -p web/tsconfig.json`: Web-Typecheck.
- `git diff --check`: Patchprüfung.

Noch offen: API-End-to-End-Tests mit echten Sessions/PostgreSQL, echter Baïkal,
Android/DAVx⁵, Browser/Desktop/Mobil, vollständige vCard-Roundtrips,
Drei-Wege-Konflikte, Journal-/Migrationsprüfungen. In dieser Umgebung waren
Docker, Podman, PHP und psql nicht vorhanden; kein externer Testserver verwendet.
Neue Migrationen gibt es in diesem PR nicht.

Bekannte Grenzen: gleiche UID in mehreren Büchern wird geschützt, aber noch nicht
vollständig dargestellt. Gleiche Server-URL über mehrere Frigg-Konten bleibt ein
Identitätsproblem. Advisory-Lock serialisiert Syncs, noch nicht Sync gegen lokale
Kontaktmutationen. Delta-Fallback ist weiterhin breit; ein unvollständiger, vom
Server fälschlich als erfolgreich gemeldeter Snapshot ist nicht vollständig
abgesichert. Kein Operationsjournal; Teilfehler erfordern Prüfung. Bestehende
vCard-Bearbeitungsrisiken sind noch offen. Daher Draft, keine Freigabe zur Produktion.

## Späteres Deployment und Wiederherstellung

Kein Merge, Deployment oder produktiver Datenzugriff erfolgt. Keine neuen
Konfigurationsvariablen oder Migrationen für PR 1. Vor einer späteren Freigabe:
PostgreSQL und CardDAV vollständig sichern, Wiederherstellung isoliert prüfen;
API und Web gemeinsam aktualisieren (Foto/Move benötigen nun If-Match).
Bestandskontakte ohne href/ETag müssen über einen geprüften Sync vervollständigt
werden. Bei Teilfehlern beide Bücher sichern und vergleichen; keine automatische
Löschung zur „Bereinigung“. Rollback des Codes ändert keine Datenbankstruktur,
würde aber alte unsichere Schreibpfade wieder aktivieren; vorher Schreibzugriffe
stoppen. Folge-Migrationen benötigen gesonderte Vorwärts-/Wiederherstellungsnachweise.

## PR 2: vCard-Bearbeitung und Drei-Wege-Konflikte

Aufbauend auf PR 1 (separater Branch `feat/vcard-conflict-resolution`):

- `vcardDocument.ts` hält strukturierte Inhaltszeilen mit Originalsyntax und
  Eigenschaftsreferenzen. Nur explizit bearbeitete Werte werden serialisiert;
  UTF-8-Faltung, Escaping, gruppierte Properties, zusätzliche N/ORG/ADR-Komponenten
  und unbekannte Parameter bleiben erhalten. Nicht unterstützte Encodings werden
  bei Bearbeitung blockiert. Unveränderte Felder werden nicht neu aufgebaut.
- `vcf` bleibt als zusätzliche Parserprüfung erhalten, aber wird bewusst nicht
  zum Neu-Serialisieren der gesamten Karte verwendet: der installierte Serializer
  gruppiert Properties und ändert v3-Parameter in Großbuchstaben. Die begrenzte
  syntaxerhaltende Schicht ersetzt die bisherigen Regex-Patches.
- Erstellen nutzt dieselbe Serialisierung. vCard-Import überträgt Originaldaten
  einschließlich UID und Foto; UID-Kollisionen werden noch konservativ blockiert.
- Editor lädt vor Bearbeitung frisch vom Server. Text und Foto werden gemeinsam
  bedingt geschrieben. Keine automatische Telefonnummer-Normalisierung beim
  Speichern unveränderter Werte. Geburtstage ohne Jahr bleiben erhalten.
- Drei-Wege-Dialog zeigt Basis, eigene und aktuelle Serverwerte; unveränderte
  Felder stammen vom Server. Gleichzeitige Änderungen desselben Felds benötigen
  eine explizite Wahl. Erneute Konflikte werden erneut verglichen; Abbruch lässt
  Eingaben erhalten. Mehrwertige Felder bilden jeweils eine Entscheidungseinheit.
- UI und API behandeln Eigenschaftsreferenzen als opake Bearbeitungsreferenzen.
  Parameteränderungen durch andere Clients können die eigene Auswahl konservativ
  blockieren (`stale_property`) statt fremde Metadaten falsch zuzuordnen.

Validierung: 51 Unit-/HTTP-Tests erfolgreich. Drei Playwright-Browsertests
(synthetischer API-Server, keine produktive Session) prüfen wiederholte Konflikte
auf Desktop und bei 390px Dialogbreite, Abbruch sowie Verbindungsabbruch.
Screenshots wurden geprüft; vorhandene Farben/Typografie/Komponenten bleiben.
`@playwright/test` ist eine neue reine Entwicklungsabhängigkeit.

Die Browserprüfung der mobilen Dialoge behebt noch nicht das im Altbestand feste
Dreispalten-Hauptlayout. Vollständige mobile Navigation bleibt gesondert zu prüfen.
Keine Migrationen in PR 2. Für Bestandsdaten liefert der neue Edit-Endpunkt aktuelle
Eigenschaftsreferenzen ohne erzwungenen Massen-Reparse. API und Web gemeinsam ausrollen.

## PR 3: interne Identitäten und wiederaufnehmbare Kontaktoperationen

Migration `005_contact_identity_operations.sql` ergänzt `vcard_uid` und ein
Operationsjournal. Der bisherige Primärschlüssel `contacts.uid` wird **nicht**
umgeschrieben oder gelöscht: er ist künftig die opake interne Kennung, auf die
bestehende lokale Gruppen und UI-Verweise weiterhin zeigen. Die vCard-UID ist
separat innerhalb eines Adressbuchs eindeutig. Neue Kontakte erhalten eine interne
Kennung unabhängig von ihrer vCard-UID. Bestehende Kontaktdaten bleiben erhalten.

Ein Move-/Merge-Plan enthält beide Original-Snapshots, Zieladresse und Ergebnis.
Der Plan wird vor dem ersten Schreibversuch gespeichert. Zustände:
`prepared → writing → target_verified → source_deleted → complete`.
Nach Antwortverlust wird die feste Zieladresse gelesen; passende Ergebnisse werden
nicht erneut geschrieben. Quelle und Ziel werden vor Fortsetzung auf Änderungen
geprüft. Abbruch einer bereits kopierten, noch vorhandenen Quelle kann beide
Kopien erhalten. Ein fehlgeschlagener Datenbankabschluss wird erneut ausgeführt.

Der echte Merge zeigt alle Eigenschaften und Ergebniswerte. Mehrfachwerte werden
vereinigt; unterschiedliche Einzelwerte benötigen Entscheidungen. Unbekannte
widersprüchliche Eigenschaften, verschiedene vCard-Versionen und nicht sicher
zuordenbare Property-Gruppen blockieren die Zusammenführung. Lokale Gruppen-
mitgliedschaften werden beim lokalen Abschluss transaktional übertragen. Bekannte
MEMBER-/RELATED-Referenzen auf die Quelle blockieren Move/Merge, damit keine
Gruppenreferenz unbemerkt verwaist. Der ursprüngliche UID-Wert wird zusätzlich als
`X-FRIGG-MERGED-UID` im Ergebnis erhalten.

Aktive Journale blockieren den Sync der beteiligten Bücher; lokale Kontaktänderungen,
Gruppenänderungen, Import und Sync verwenden denselben Prozess-übergreifenden
PostgreSQL-Lock. Konkurrierende Anfragen bekommen `423 operation_busy` statt
unbegrenzt Pool-Verbindungen zu belegen. „Offene Vorgänge“ bietet Vorschau,
Wiederaufnahme und sicheres Behalten vorhandener Kopien.

### Validierung und Integration

- Migration 001–005 mit synthetischen Bestandskontakten und Gruppen auf PGlite
  (echte PostgreSQL-Engine in WASM, Entwicklungsabhängigkeit) ausgeführt; 005
  mehrfach wiederholt. Bestehende IDs/Referenzen erhalten; gleiche vCard-UID in
  zwei Büchern erfolgreich gespeichert, Kollision im selben Buch abgewiesen.
- Fehlerfolge für Move und Merge: verlorene PUT-Antwort, fehlgeschlagene Prüfung,
  verlorene DELETE-Antwort, Datenbankfehler und fehlgeschlagener Abschluss-Checkpoint.
  Wiederholung erzeugt keinen zusätzlichen PUT und verliert keine Quelle.
- **Echter Baïkal 0.13.0 / sabre-dav 4.7.1** isoliert auf 127.0.0.1 mit temporärem
  SQLite, synthetischem Benutzer und zwei Büchern gestartet. Release-SHA256 wird
  vor Entpacken geprüft. PHP wurde lokal nur aus offiziellen Paketen in `/tmp`
  entpackt; keine Systeminstallation und kein Zugriff auf produktive Dienste.
- Integration durch die echten Express-Routen mit Session-Prüfung und verschlüsselten
  synthetischen DAV-Zugangsdaten: CRUD, beliebiger Ressourcenname ohne `.vcf`,
  gleiche UID in zwei Büchern, Konflikt nach noch nicht synchronisierter externer
  Änderung, Merge einschließlich lokaler Gruppenmitgliedschaft, Move, Wiederholung
  und Delta-Sync erfolgreich. Fremder Benutzer erhält keinen Zugriff auf Kontakt
  oder Journal. PGlite ersetzt den PostgreSQL-Netzwerkprozess, nicht die SQL-Engine;
  Mehrprozess-Lock-Verhalten ist dadurch noch kein echter PostgreSQL-Lasttest.
- Baïkal lieferte bei fehlenden Multiget-Zielen ein leeres Ergebnis. Deshalb erfolgen
  Einzelverifikation und Edit-Lesezugriffe jetzt per authentifiziertem GET mit
  eindeutigem Status, vollständigem Inhalt und Response-ETag.
- Der CI-Workflow lädt dieselbe geprüfte Baïkal-Version und führt `npm run test:baikal`
  aus. Lokal: `FRIGG_BAIKAL_RELEASE=/pfad/zum/test-release npm run test:baikal`;
  optional `FRIGG_TEST_PHP` und `FRIGG_TEST_PHP_EXT` für isolierte PHP-Laufzeiten.

### Migration und Wiederherstellung

Vor späterem Deployment API/Sync anhalten und PostgreSQL sowie CardDAV sichern.
Migrationen 001–004 müssen vorhanden sein; dann 005 transaktional ausführen und
API/Web gemeinsam starten. Keine Datenbereinigung, kein Löschen alter Spalten,
keine automatische Gruppenumwandlung. Journal-Snapshots enthalten persönliche
Daten und benötigen denselben Zugriffsschutz und dieselben Backups wie Kontakte.

Nach 005 darf alter Code nicht weiter schreiben: er verwechselt interne und
vCard-UIDs. Wiederherstellung erfolgt bei angehaltenen Schreibern aus dem vorab
geprüften Datenbankbackup und den passenden CardDAV-Sicherungen. Kein pauschales
SQL-Down-Skript, das neu entstandene Kontakte oder Journale verwirft. Bei einem
Teilvorgang erst Journal und beide Serverressourcen vergleichen; niemals die
Zielkopie automatisch löschen. Der vorhandene globale href-Index bleibt bestehen;
mehrfach verbundene identische Serverressourcen werden konservativ blockiert.

## PR 4: synchronisierte Gruppen und native Serverrepräsentation

Migration 006 ergänzt `resource_kind` und setzt Sync-Marker zurück, damit bestehende
Gruppenressourcen neu klassifiziert werden. Kontakte und lokale Mitgliedschaften
bleiben erhalten. Keine lokale Gruppe wird umgewandelt. API/Web gemeinsam nach
005 und 006 starten; Backup-/Wiederherstellungsregeln aus PR 3 gelten weiterhin.

Gruppen besitzen getrennte, authentifizierte Endpunkte und eine sichtbare Kennzeichnung.
Unterstützt werden vCard 4 KIND/MEMBER und vCard 3 mit Apple-X-Eigenschaften.
Capabilities und Schreibprivilegien werden vor Anlage geprüft. Mitglieder müssen
im selben Buch existieren; doppelte Zuordnungen erzeugen keine neuen Einträge.
Unbekannte Referenzen bleiben erhalten. Gemischte/unbekannte Gruppenformate sind
schreibgeschützt. Umbenennen, Mitgliedschaft und Löschen benötigen starke ETags;
eine zwischenzeitliche Änderung liefert 409 und die aktuelle Gruppe.

**Korrektur des PR-3-Lesewegs:** Baïkal/sabre konvertiert GET sowie Multiget ohne
Versionsangabe zu vCard 3, bei unverändertem Ressourcen-ETag. Deshalb liest Frigg
jetzt die native `address-data`-Eigenschaft per PROPFIND (Tiefe 0), auch beim Sync.
Dieser von Baïkal unterstützte Zugriff ist eine Servererweiterung, keine universelle
CardDAV-Garantie. Fehlt sie, wird sicher abgebrochen (`native_vcard_unavailable`);
kein Rückfall auf eine möglicherweise verlustbehaftete Konvertierung. Zusätzliche
Leseanfragen erhöhen die Dauer großer Synchronisationen. Eine spätere Optimierung
muss denselben Erhalt der Originalrepräsentation nachweisen.

Referenzen auf Move-/Merge-Quellen werden vor Vorschau und unmittelbar vor dem
bedingten Löschen erneut aus nativen Serverdaten geprüft. Zwischen verschiedenen
Ressourcen kann CardDAV keine atomare Transaktion garantieren; ein externer Client
kann danach weiterhin eine Referenz anlegen. Journale behalten die Originaldaten.

### DAVx⁵-Nachweis und Grenzen

Am 21.11.2026 geprüfte Primärquellen:

- [Baïkal-Konfiguration](https://www.davx5.com/tested-with/baikal): separate vCards.
- [Technische Dokumentation](https://manual.davx5.com/technical_information.html):
  vCard-4-Gruppen und Apple-Eigenschaften für vCard 3.
- [Android-Gruppenunterstützung](https://www.davx5.com/faq/cant-manage-groups-on-device):
  CATEGORIES und separate vCards sind unterschiedliche Methoden; die Darstellung
  und Bearbeitung hängen zusätzlich von der Android-Kontakte-App ab.

Frigg verwendet separate vCards, keine automatische CATEGORIES-Konvertierung.
Der echte Baïkal-Test prüft beide Formate, Anlage, Hinzufügen/Entfernen, doppelte und
fehlende Mitglieder, externes Umbenennen, ETag-Konflikt, Full-/Delta-Sync und Löschung.
Lokale Gruppen bleiben im selben Test erhalten. Ungültige Sync-Tokens lösen einen
vollständigen Neuabgleich aus. Unit-Tests prüfen unbekannte Formate und Referenzen.
Browser-Tests prüfen Gruppenanlage bei Desktop- und mobiler Dialoggröße sowie die
Sperre bei fehlender Serverunterstützung.

**Offen:** Es wurde kein Android-Gerät/Emulator mit DAVx⁵ und konkreter Kontakte-App
betrieben. Protokolltests plus Herstellerdokumentation ersetzen diesen Ende-zu-Ende-
Nachweis nicht. Vor Freigabe sind mindestens Download/Upload einer Gruppe, externer
Rename, Mitgliedschaft und Löschung mit der vorgesehenen DAVx⁵-/Android-Konfiguration
an synthetischen Kontakten zu prüfen. Ebenso offen: nativer PostgreSQL-Mehrprozess-
Lasttest, weitere CardDAV-Server und vollständige mobile Navigation (bisher Dialogtests).

## PR 5: abschließende Regressionen und mobile Bedienung (22.11.2026)

Die Sammlungsliste von tsdav kann HTTP-/XML-Fehler in ein leeres Ergebnis umformen.
Frigg verwendet deshalb eine geprüfte Sammlungsliste und native Einzelressourcen.
HTTP-Fehler, ungültige XML-Antworten, verschwundene Ressourcen und fehlende starke
ETags brechen ab; sie dürfen keinen erfolgreichen leeren Abgleich auslösen.
Auch Request-Objekte durchlaufen die Schreibbedingungsprüfung. Referenzen beim
Move/Merge berücksichtigen zusätzlich Ressourcen-URLs und UUID-Großschreibung.

Unter 900 px sind die vorhandenen drei Bereiche einzeln über Navigation/Kontakte/
Details erreichbar. Der Desktop bleibt dreispaltig. Verschieben ist auf Touchgeräten
über eine Adressbuchauswahl bedienbar. Löschfehler lassen den Kontakt sichtbar und
zeigen eine Meldung; der vorhandene Bestätigungsdialog blockiert die Oberfläche
nach einem fehlgeschlagenen Löschen nicht länger. Gruppen-Netzwerkfehler werden
angezeigt, unbekannte bzw. fremdbuchige Gruppen nicht zur Zuordnung angeboten.
Lokale Gruppenfehler loggen keine vollständigen Datenbankfehlermeldungen mehr.

### Letzter lokaler Teststand

- `npm test`: **68 Tests erfolgreich**, einschließlich Migrationen, Parser,
  bedingtem Transport, Sync-Abbrüchen, Konfliktentscheidungen und Journallebenszyklus.
- `npm run test:baikal` mit isoliertem Release/PHP: **erfolgreich**. Zusätzlich
  Erhalt einer unbekannten Unicode-Eigenschaft mit mehr als 12 KB durch Bearbeitung
  und Sperre des Verschiebens referenzierter Gruppenmitglieder nachgewiesen.
- `npm run test:browser`: **11 Tests erfolgreich**. Desktop und mobiler Einstieg,
  wiederholter Bearbeitungskonflikt, Abbruch/offline, Merge-Entscheidung, Move-Teilfehler,
  Gruppenanlage/-mitgliedschaft/-konflikt und fehlende Gruppenunterstützung.
- `npm run build`: **API und Next.js-Produktionsbuild erfolgreich**.
- `git diff --check`: erfolgreich. Screenshots von mobilem Kontakt, Konflikt,
  Merge und Gruppenanlage visuell geprüft. CI archiviert nur synthetische Testbilder
  und Fehler-Traces für sieben Tage; keine produktiven Daten.
- Während der Entwicklung schlug der neue mobile Test zunächst wegen eines
  mehrdeutigen Alert-Selektors fehl, anschließend wegen des blockierenden
  Bestätigungsdialogs. Selektor und tatsächlicher Dialogfehler sind behoben.
  Dev-Server-Meldungen zu abgebrochenen Testanfragen sind kein Nachweis eines
  produktiven Fehlers; Tests und anschließender Produktionsbuild bestehen.

### Abhängigkeiten und Sicherheitsprüfung

Vorher meldete `npm audit` 13 Befunde (2 kritisch, 6 hoch, 5 moderat). Updates innerhalb
von Next.js 15 (15.5.29) und der bestehenden Abhängigkeiten sowie begrenzte Overrides
für PostCSS 8.5.33 und Express' qs 6.17.1 reduzieren dies auf **2 moderate Befunde**,
keine hohen/kritischen. `npm ci` und Build/Test wurden mit dem aktualisierten Lockfile
geprüft. Keine neue Laufzeitarchitektur und kein Framework-Major-Upgrade.

Offen bleibt [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
im bestehenden node-cron→uuid-Pfad (Audit zählt beide Pakete). Der geprüfte Scheduler
verwendet `uuid.v4()` ohne benutzerdefinierten Puffer; die Meldung betrifft v3/v5/v6
mit Puffer. Dies ist eine begrenzte Erreichbarkeitsbewertung, keine allgemeine
Sicherheitsfreigabe. Ein Scheduler-Major-Upgrade wurde nicht ungeprüft erzwungen.

### Abnahmestand und Review-Reihenfolge

| Bereich | Stand | Verbleibende Grenze |
| --- | --- | --- |
| A Konflikte | Bedingte Writes/Deletes, Drei-Wege-Dialog, erneute Konflikte getestet | Server muss starke ETags und Preconditions korrekt durchsetzen |
| B vCards | Unbekannte Daten, Parameter, Faltung, Unicode und strukturierte Bestandteile erhalten | Nicht sicher interpretierbare Änderungen werden abgewiesen |
| C Merge | Vorschau, Feldentscheidung, echte Übernahme, Journal/Wiederaufnahme | Mehrdeutige unbekannte Daten und referenzierte Quellen blockieren |
| D Move | Ziel erstellen/verifizieren, Quelle bedingt löschen, Journal/Idempotenz | CardDAV bietet keine atomare Mehrressourcen-Transaktion |
| E Gruppen | Beide Formate auf echtem Baïkal getestet; lokale/intelligente Gruppen erhalten | **Android/DAVx⁵-Ende-zu-Ende-Test offen** |
| Migrationen | 005/006 additiv und wiederholt auf synthetischem Bestand getestet | Wiederherstellung über geprüfte Backups; kein destruktives Down-Skript |
| Gestaltung | Bestehende Farben/Typografie/Listen, Desktop und mobile Abläufe geprüft | Chromium geprüft; keine vollständige Browser-/Gerätematrix |
| Sicherheit | Session-/Benutzer-/Buchzugriff geprüft, konditionale Writes, Logs reduziert | Zwei moderate Audit-Meldungen; kein externer Sicherheitstest |

Die Draft-PRs bauen aufeinander auf: **#1 → #2 → #3 → #4 → #5**. Nicht einzeln
produktiv ausrollen: erst den vollständigen Stapel prüfen, anschließend die
Migrations- und Wiederherstellungsanleitung beachten. PR 5 korrigiert insbesondere
Sammlungsfehler und vervollständigt die mobile Bedienung.

Der Gesamtauftrag ist wegen des offenen realen DAVx⁵-/Android-Nachweises noch nicht
vollständig abgenommen. Ein nativer PostgreSQL-Mehrprozess-Test sowie Tests weiterer
Server bleiben zusätzliche offene Nachweise. Es wurden keine produktiven Kontakte
verändert, kein Deployment ausgeführt und kein PR gemergt.

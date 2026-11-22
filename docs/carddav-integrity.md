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
Auch Request-Objekte durchlaufen die Schreibbedingungsprüfung. Move-/Merge-Vorschauen prüfen zusätzlich explizite Serverrechte für Anlage, Änderung
und Entfernen; fehlende oder nicht ausgewiesene Rechte blockieren die Vorschau.
Referenzen beim Move/Merge berücksichtigen zusätzlich Ressourcen-URLs und UUID-Großschreibung.

Unter 900 px sind die vorhandenen drei Bereiche einzeln über Navigation/Kontakte/
Details erreichbar. Der Desktop bleibt dreispaltig. Verschieben ist auf Touchgeräten
über eine Adressbuchauswahl bedienbar. Löschfehler lassen den Kontakt sichtbar und
zeigen eine Meldung; der vorhandene Bestätigungsdialog blockiert die Oberfläche
nach einem fehlgeschlagenen Löschen nicht länger. Gruppen-Netzwerkfehler werden
angezeigt, unbekannte bzw. fremdbuchige Gruppen nicht zur Zuordnung angeboten.
Lokale Gruppenfehler loggen keine vollständigen Datenbankfehlermeldungen mehr.

### Letzter lokaler Teststand

- `npm test`: **69 Tests erfolgreich**, einschließlich Migrationen, Parser,
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

## Abschließende technische Abnahme – 22.11.2026

Dieser Abschnitt ersetzt die oben historisch aufgeführten offenen Teststände, soweit
hier neue Nachweise angegeben sind. Basis war der saubere Head von PR #5,
`c1baefd5cc0db598e7e8f3bdf4e0b558800282ac`. Alle fünf PRs sind offen und Draft;
Bases/Heads bilden unverändert #1 → #2 → #3 → #4 → #5. Ergänzungen bleiben in #5:
Testinfrastruktur, konkrete Testlücken, eine begrenzte Logkorrektur und Dokumentation.
Keine neue Produktfunktion, keine Gestaltung geändert. Kein Merge/Deployment.

### Ausgangsmessung und abschließende Regression

Vor Änderungen erneut erfolgreich: `npm ci`, 69 Unit-/HTTP-/Migrationstests,
11 Chromium-Browsertests, echte isolierte Baïkal-Integration und API/Web-Build.
Der CI-Lauf des Ausgangs-Heads war erfolgreich:
[Integrity tests #12](https://github.com/skords83/frigg/actions/runs/44992967017).
Die abschließenden Prüfungen werden am Ende dieses Abschnitts protokolliert.

Alle Kontakte, Benutzer, Sitzungen und DAV-Zugangsdaten sind synthetisch. Der
native Test erzeugt seinen eigenen Unix-Socket-Cluster unter `/tmp/frigg-native-pg-*`,
verwirft geerbte Verbindungsparameter, akzeptiert keine `DATABASE_URL`, bindet
keinen PostgreSQL-TCP-Port und entfernt den Cluster beim Ende. Er startet nur
einen eigenen temporären Baïkal; bestehende Baïkal-Instanzen werden nicht geändert.

### Nativer PostgreSQL-Mehrprozess-Nachweis

`npm run test:postgres` verwendet echte PostgreSQL-Verbindungen und unabhängige
Node-Prozesse mit den echten Express-Routen, Authentifizierung, Operationsengine
und Synchronisation. Die DAV-Anfragen gehen an den echten isolierten Baïkal.
Testbarrieren halten gezielt Requests/Checkpoints an; sie ersetzen weder SQL noch
DAV-Ergebnisse. Fehler werden durch SIGKILL und `pg_terminate_backend` erzeugt.

Lokal geprüft mit PostgreSQL **18.7**, Baïkal **0.13.0**, Node **26.13.1**.
Zusätzlich BESTANDEN in [CI #16](https://github.com/skords83/frigg/actions/runs/45017745905)
auf PostgreSQL **16.16**, passend zur Hauptversion in `compose.yaml`, und Node 22.
Alle oben genannten nativen Szenarien liefen dort ohne Skip erfolgreich durch.

| Automatisiertes Szenario | Ergebnis / überprüfte Invariante |
| --- | --- |
| Zwei API-Prozesse bearbeiten denselben Kontakt | BESTANDEN: Gewinner 200; paralleler Schreiber 423; spätere veraltete Version 409; Gewinnerinhalt bleibt erhalten |
| Sync während angehaltener Kontaktänderung | BESTANDEN: separater Sync-Prozess übernimmt die Sperre nicht, keine parallelen Schreibzugriffe |
| Zwei Prozesse setzen denselben Move fort | BESTANDEN: zweiter Prozess 423, danach idempotent 200 ohne weiteres DAV-PUT/DELETE |
| Merge während laufendem Sync | BESTANDEN: Merge zunächst 423; Sync überspringt Bücher mit aktivem Journal; Merge danach vollständig |
| SIGKILL nach Ziel-PUT vor Verifikationscheckpoint | BESTANDEN: Journal bleibt `writing`; neuer Prozess liest vorhandenes Ziel, kein zweites PUT, genau ein erfolgreiches DELETE |
| Verlust der separaten Sperrverbindung | BESTANDEN: betroffener API-Prozess beendet sich mit Fehler; Sperre frei; neuer Prozess setzt denselben Vorgang fort |
| Abbruch einer tatsächlich laufenden DB-Abfrage | BESTANDEN: Backend-Terminierung im Checkpoint; HTTP 503, `last_error=operation_unconfirmed`; Wiederaufnahme ohne zusätzliches PUT |
| SIGKILL nach Quellenlöschung | BESTANDEN: `target_verified` bleibt nachvollziehbar; Wiederaufnahme ohne erneutes DELETE |
| SIGKILL nach lokalem Commit | BESTANDEN: `source_deleted`; erneuter lokaler Abschluss konsistent, kein zusätzliches DAV-Schreiben |
| PostgreSQL-Neustart | BESTANDEN: vollständige Journalzeilen einschließlich Snapshots unverändert |
| Lock-Timeout / Deadlock | BESTANDEN: native Sessions liefern 55P03 / 40P01, anschließend keine verbliebene Frigg-Sperre |
| Backup und Restore | BESTANDEN: pg_dump/pg_restore in neue DB; Kontakte, Bücher, lokale Gruppen, Mitgliedschaften und Journal zeilenweise identisch |

Die Deadlock-Probe erzeugt einen absichtlichen Zyklus mit separaten Test-Locks;
sie behauptet keinen gefundenen Deadlock in Frigg. Friggs einzelner globaler
`pg_try_advisory_lock` wartet bei Konkurrenz nicht. Dies ist ein deterministischer
Integritäts-/Ausfalltest, kein Durchsatz- oder Langzeitlasttest. Beim Verlust der
Sperrverbindung ist derzeit der Prozessabbruch die Schutzwirkung des nicht
abgefangenen `pg`-Clientfehlers. Ein Prozessmanager muss ihn neu starten
(`restart: unless-stopped` ist vorhanden); Journale werden anschließend ausdrücklich
wiederaufgenommen. Ein künftiges Abfangen dieses Fehlers darf den Handler nicht
ohne Sperre weiterlaufen lassen. Ein stiller Netzwerkausfall ohne sofortige
TCP-Fehlermeldung und beliebig lange Netzpartitionen wurden nicht simuliert.

Reproduktion (PostgreSQL-Server/Client einschließlich `pg_trgm`, PHP mit SQLite,
Python 3, npm-Abhängigkeiten; als unprivilegierter Benutzer):

```sh
npm ci
bash tests/integration/download-baikal.sh /tmp/frigg-baikal-test
FRIGG_BAIKAL_RELEASE=/tmp/frigg-baikal-test/baikal \
FRIGG_TEST_PG_BIN="$(pg_config --bindir)" npm run test:postgres
```

Bei lokal entpackten Laufzeiten zusätzlich `FRIGG_TEST_PHP`,
`FRIGG_TEST_PHP_EXT` und deren `LD_LIBRARY_PATH` setzen. Kein produktiver
Verbindungsstring erforderlich oder erlaubt. Der Lauf muss die `POSTGRES PASS:`-
Zeilen und abschließend einen bestandenen Test ohne Skip enthalten.

### Gefundene Probleme und konkrete Ergänzungen

- **Sicherheitskorrektur:** `api/src/db.ts` protokollierte im Pool-Fehlerhandler
  das vollständige Fehlerobjekt. Der echte Server-Neustart zeigte darin ein
  angehängtes Clientobjekt mit internen Verbindungs-/Authentifizierungsdetails.
  Stattdessen wird jetzt nur eine feste Fehlermeldung ausgegeben; das Verwerfen
  der defekten Verbindung durch pg bleibt unverändert.
- **Baïkal-Testlücken geschlossen:** erfolgreiche Umbenennung aus Frigg und Erhalt
  einer extern eingefügten unbekannten MEMBER-Referenz über Umbenennen und
  Entfernen eines bekannten Mitglieds, jeweils vCard 4 und Apple/vCard 3.
  Ein absichtlich als Kontakt gecachter Gruppeneintrag wird nach erneuter 006 und
  Sync wieder als Gruppe klassifiziert. Vorhandene CRUD-, Konflikt-, Rechte- und
  lokalen Gruppentests bleiben bestehen.
- **Testgerüst korrigiert:** Baïkal entfernt gegebenenfalls den abschließenden
  Zeilenumbruch; die Ergebnisprüfung toleriert genau diesen Unterschied.
  Der Neustart benötigte eine eigene Server-Logdatei und die Verarbeitung der
  geschlossenen Pool-Sockets vor Wiederbenutzung. Diese anfänglich fehlgeschlagenen
  Testläufe sind keine Produktfehler und wurden nicht als Erfolg gezählt.

### Sicherheitsbewertung der verbleibenden Audit-Meldungen

Erneut: **zwei moderate Meldungen**, null hoch/kritisch. Installiert sind
`node-cron@3.0.3 → uuid@8.3.2`. `npm view node-cron versions` zeigt kein neueres
3.x-Release; das Audit schlägt `node-cron@4.6.0` als Major-Wechsel vor.
Die Advisory [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
betrifft v3/v5/v6-Aufrufe mit externem Buffer/Offset; behoben u.a. in uuid 11.1.1.
Das wäre gegenüber uuid 8 ebenfalls ein Major-Wechsel außerhalb des bisherigen
Abhängigkeitsvertrags. Kein ungeprüftes Upgrade und kein UUID-Override vorgenommen.

Tatsächlicher Pfad: `api/src/sync.ts:startSyncSchedule` →
`cron.schedule('*/5 * * * *', callback)` →
`node-cron/src/scheduled-task.js` → `uuid.v4()` ohne Argumente.
Auch die Namens-Fallbacks in `storage.js` und
`background-scheduled-task/index.js` verwenden ausschließlich `v4()` ohne Buffer.
Frigg verwendet den Background-Task-Pfad nicht. Anwendungscode ruft keine
UUID-v3/v5/v6-Funktion auf; Kontaktinhalte werden diesem Pfad nicht übergeben.
**Der gemeldete Fehler ist in diesen geprüften Aufrufpfaden nicht erreichbar.**
Die Abhängigkeit bleibt jedoch betroffen und `npm audit` bleibt nicht erfolgreich;
der Befund ist ausdrücklich **nicht behoben**. Neue Scheduler-Nutzung oder ein
Abhängigkeitswechsel erfordern eine erneute Bewertung.

### Manueller Android-/DAVx⁵-Abnahmetest – noch nicht ausgeführt

`adb devices` fand kein Gerät; kein installierter Emulator/AVD in den geprüften
SDK-Verzeichnissen. **Die vollständige DAVx⁵-/Android-Kompatibilität ist OFFEN.**
Protokolltests und Quellenprüfung ersetzen den Gerätetest nicht.

1. Isolierte Baïkal-Testinstanz beziehungsweise ausdrücklich separates Testkonto
   mit neuem Adressbuch „Frigg Abnahme“ einrichten. Nur dieses Konto in einer
   isolierten Frigg-Testinstallation verbinden. Keine Familienkonten einbinden.
   Für das Smartphone eine erreichbare HTTPS-URL mit gültigem Zertifikat verwenden;
   `127.0.0.1` auf dem Telefon wäre das Telefon selbst.
2. In DAVx⁵ neues Konto mit Test-URL `/dav.php/` (installationsabhängig
   `/html/dav.php/`) und Testzugangsdaten anlegen. Unter Kontaktgruppenmethode
   **„Gruppen sind separate vCards“** wählen, nicht CATEGORIES. Nur das
   Testadressbuch aktivieren, Kontakteberechtigung erteilen, manuell synchronisieren.
3. In der Kontakte-App nur das DAVx⁵-Testadressbuch anzeigen und es beim Anlegen
   ausdrücklich als Speicherort wählen, nicht Telefon/Google/anderes Konto.
   Prüfen, dass diese App Gruppen/Labels dieses Kontos anzeigen **und bearbeiten**
   kann. Fehlende Funktionen als App-Einschränkung erfassen; nicht automatisch
   DAVx⁵ oder Frigg zuschreiben. DAVx⁵ synchronisiert; die Kontakte-App stellt
   Android-Kontakte und Gruppen dar und bearbeitet sie.
4. In Frigg „Test Ada“ und „Test Berta“ mit `.invalid`-Mailadressen anlegen, Gruppe
   „Test Team“ erstellen und Ada zuordnen. DAVx⁵ synchronisieren: beide Kontakte
   genau einmal, eine Gruppe, ausschließlich Ada als Mitglied. Gruppen-vCard
   darf nicht als normaler Personenkontakt erscheinen.
5. In der Android-App Berta hinzufügen und Ada entfernen. DAVx⁵ synchronisieren,
   danach Frigg-Sync ausführen: genau Berta ist Mitglied. Anschließend in Frigg
   die Gegenänderung durchführen und auf Android prüfen.
6. Gruppe auf Android umbenennen, synchronisieren und in Frigg prüfen. Danach
   in Frigg erneut umbenennen und Android prüfen. Zusätzlich eine zweite Gruppe
   auf Android anlegen, Kontakte zuordnen und in Frigg prüfen.
7. Je eine Gruppe auf jeder Seite löschen und in beide Richtungen synchronisieren.
   Gruppen verschwinden, Personenkontakte bleiben erhalten. Drei weitere
   Sync-Durchläufe dürfen weder Gruppen noch Mitgliedschaften wiederherstellen.
8. Optional kontrollierter Konkurrenzfall: Frigg-Dialog offen lassen, dieselbe
   Gruppe auf Android ändern und synchronisieren, dann den alten Dialog speichern.
   Erwartet: sichtbarer Versionskonflikt, keine stille Überschreibung. Erneut
   laden und die gewünschte Änderung mit aktueller Version ausführen.
9. Protokoll: Android-Version/Gerät, DAVx⁵-Version, Kontakte-App/Version,
   Baïkal-Version, Gruppenmethode, Frigg-Commit, Zeitpunkt, Aktion/Richtung,
   Soll/Ist, synthetische Screenshots und gegebenenfalls bereinigte Sync-Logs.
   Für jede Aktion BESTANDEN/FEHLGESCHLAGEN/OFFEN eintragen. Mit anderer App
   wiederholen, wenn nur deren Gruppenbedienung fehlt; beide Ergebnisse erhalten.

Aktuell geprüfte Herstellerquellen:
[Baïkal-Einstellungen](https://www.davx5.com/tested-with/baikal) und
[Aufgabenteilung und Gruppenunterstützung](https://www.davx5.com/faq/cant-manage-groups-on-device).

### Kontrollierte Produktionsmigration – ausschließlich später manuell

Der folgende Ablauf wurde **nicht produktiv ausgeführt**. Synthetisch erprobt sind
native 005/006, Wiederholung, Erhalt alter IDs/Mitgliedschaften, UID-Eindeutigkeit,
Gruppen-Reklassifikation, PostgreSQL-Dump/Restore und SQLite-Backup mit
Integritäts- und Inhaltsvergleich. Die tatsächliche Produktionsumgebung und deren
Backups müssen vor Freigabe separat geprüft werden.

1. Wartungsfenster festlegen, Benutzerzugriffe sperren. **Alle API-Replikate und
   Sync-/Worker-Prozesse anhalten**, automatischen Neustart alter Container und
   automatische Deployments verhindern. Web ebenfalls stoppen. Auch externe
   DAV-Clients pausieren bzw. Test-/Wartungszugriff auf Baïkal begrenzen, damit
   beide Sicherungen denselben ruhenden Datenstand abbilden. Offene Journale und
   ihre Zustände dokumentieren; vor Migration vorzugsweise kontrolliert abschließen.
2. PostgreSQL mit `pg_dump --format=custom --file=frigg-before.dump "$BACKUP_DB_URL"`
   sichern; notwendige Rollen/Grants separat sichern. Variable bewusst auf die
   freigegebene Instanz setzen, nie aus dieser Testanleitung ableiten. Geschützte
   Dateirechte (`umask 077`), verschlüsselte Ablage und Prüfsummen verwenden.
   Commit/Image-Digests, Schema-Stand, Bestandszahlen und Sicherungszeit erfassen.
3. Baïkal vollständig sichern: SQL-Datenbank (SQLite über konsistentes Backup,
   bei MySQL/MariaDB deren passendes Dumpverfahren), Konfiguration/Specific,
   Authentifizierungsdaten und erforderliche Dateien. Ein vCard-Export allein
   ersetzt keine vollständige Wiederherstellung. Friggs
   `CREDENTIALS_ENCRYPTION_KEY` separat sicher aufbewahren; ohne ihn sind die
   gespeicherten DAV-Zugangsdaten nicht nutzbar.
4. **Vor Migration Wiederherstellbarkeit beweisen:** PostgreSQL in neue isolierte
   Datenbank mit `pg_restore --exit-on-error` zurückspielen, Baïkal in isolierter
   Instanz wiederherstellen. Anzahl und Inhalte der Kontakte, UIDs/hrefs, Gruppen,
   Mitgliedschaften, Kontenzuordnung und Journale vergleichen. Testinstanz darf
   keine Produktions-DAV-URLs erreichen. Backup-Existenz allein genügt nicht.
5. Bestehenden Schema-Stand prüfen. Bei vorhandenen 001–004 nur 005, danach 006
   ausführen, jeweils `psql -X -v ON_ERROR_STOP=1 "$MIGRATION_DB_URL" -f DATEI`.
   Bei leerer Datenbank 001–006 in Reihenfolge. **001–004 nicht blind wiederholen**;
   sie sind nicht insgesamt idempotent. Bestehende Docker-Volumes führen
   `/docker-entrypoint-initdb.d` nicht erneut aus. 005 und 006 haben eigene
   Transaktionen. 006 ist datenverträglich wiederholbar, setzt aber bei jeder
   Ausführung CTag/Sync-Token zurück; sie ist kein wirkungsloser No-op.
6. API und Web auf zusammengehörige geprüfte Image-Digests aktualisieren, beide
   zunächst angehalten lassen. **Alter Frigg-Code darf nach 005 niemals schreibend
   auf den migrierten Bestand zugreifen**, auch nicht über eine vergessene Replik.
7. Bei weiterhin gestoppter API prüfen: alte `contacts.uid` unverändert,
   `vcard_uid` befüllt, keine doppelten `(addressbook_id,vcard_uid)`, unveränderte
   lokale Gruppenmitgliedschaften, gültige Journalzustände, starke ETags/hrefs.
   006 klassifiziert Gruppen erst beim anschließenden Sync neu; temporär als
   Kontakt gecachte Gruppen dürfen nicht vorher zur Bearbeitung freigegeben werden.
   Beispielprüfungen:

   ```sql
   SELECT count(*) FROM contacts WHERE vcard_uid IS NULL;
   SELECT addressbook_id,vcard_uid,count(*) FROM contacts
     GROUP BY addressbook_id,vcard_uid HAVING count(*)>1;
   SELECT count(*) FROM contact_group_members m
     LEFT JOIN contacts c ON c.uid=m.contact_uid WHERE c.uid IS NULL;
   SELECT status,count(*) FROM contact_operations GROUP BY status;
   ```

   Die ersten drei Resultate müssen null/leer sein; Bestandszahlen und IDs gegen
   die Sicherung vergleichen, nicht nur gegen geschätzte Sollwerte.
8. Synchronisation kontrolliert freigeben: **`startSyncSchedule()` startet sofort
   mit der API und danach alle fünf Minuten; es gibt keinen Pause-Schalter.**
   Deshalb ist der Start der ersten neuen API-Instanz der Freigabepunkt für den
   ersten Sync. Zuvor alle Offline-Prüfungen abschließen; Benutzerzugang weiter
   gesperrt lassen. Einen Lauf überwachen, Fehler/offene Journale prüfen,
   Gruppenklassifikation und Bestandszahlen vergleichen. Bei Abweichung API
   sofort wieder anhalten, keine Bereinigungs-Löschungen improvisieren. Weitere
   Replikate und externe Clients erst nach erfolgreichem Abgleich freigeben.
9. Mit isoliertem Testadressbuch und synthetischen Kontakten CRUD, externe Änderung/
   Konflikt, Merge, Move und Gruppen einmal durchführen. Danach Web und Benutzer-
   zugriff freigeben. Die echten Familienkontakte sind keine Funktionstestdaten.

**Wiederherstellung bei Fehlschlag:** API, Sync, Web-Schreibzugang und externe
DAV-Schreiber erneut vollständig stoppen. Den fehlgeschlagenen Zustand inklusive
Journal und beider DAV-Kopien zusätzlich sichern. Wenn 005/006 fehlschlägt, den
Transaktionsstatus prüfen; keine API gegen einen teilweise aktualisierten Stand
starten. Aus dem geprüften zusammengehörigen PostgreSQL-/Baïkal-Backup in neue
Volumes/Instanzen wiederherstellen und vergleichen, anschließend kontrolliert
umschalten. Nicht lediglich alten Code zurückrollen oder Spalten entfernen.
Nach zwischenzeitlichen Schreibzugriffen würde das Vorher-Backup neue Daten
verlieren: diese zuerst anhand der gesicherten Journale und DAV-Ressourcen
abgleichen und gezielt übernehmen. Keine Zielkopie automatisch löschen.
Alte Images nur zusammen mit dem vollständig zurückgespielten alten Datenstand
starten; andernfalls auf dem neuen Stand gezielt vorwärts korrigieren.

### Abschließende Abnahmetabelle

| Prüfbereich | Ergebnis | Nachweis | Offene Risiken |
| --- | --- | --- | --- |
| Konfliktauflösung | BESTANDEN | Unit/HTTP, Desktop/Mobil, native konkurrierende API-Prozesse, externe Baïkal-Änderung | Server muss ETags korrekt durchsetzen |
| vCard-Verarbeitung | BESTANDEN | Parser/Roundtrips, unbekannte Eigenschaften, native Baïkal-Repräsentation | Nicht unterstützte Formate werden konservativ abgewiesen |
| Duplikat-Merge | BESTANDEN | Baïkal/Express, Mitgliedschaftserhalt, echter paralleler Sync | Keine atomare DAV-Mehrressourcen-Transaktion |
| Kontaktverschiebung | BESTANDEN | Zwei API-Prozesse, Prozessabbruch an drei Checkpoints, idempotente Fortsetzung | Externe Änderungen können Wiederaufnahme blockieren |
| CardDAV-Gruppen | BESTANDEN | Beide Formate, CRUD, Mitglieder, externer Rename/ETag-Konflikt, unbekannte Referenzen, Reklassifikation | Geräte-Ende-zu-Ende separat offen; weitere Server ungeprüft |
| PostgreSQL-Mehrprozess | BESTANDEN | `test:postgres`, native Sperren, SIGKILL, Backend-Abbruch, Neustart, Journal-Restore | Kein Last-/Netzpartitionstest; Prozessneustart bei Verlust der Sperrverbindung erforderlich |
| Android/DAVx⁵ | OFFEN | Keine passende Laufzeit/Gerät; konkrete manuelle Anleitung oben | Vollständige Kompatibilität nicht nachgewiesen |
| Migrationen | BESTANDEN | Native 005/006, alte/neue Daten, Gruppenreferenzen, wiederholte Ausführung und Dump/Restore | Produktionsbackup und vollständige dortige Restore-Probe noch vom Betreiber durchzuführen |
| Sicherheit | TEILWEISE GEPRÜFT | Rechte-/Sessiontests, bedingte DAV-Writes, korrigiertes Pool-Logging, Audit-Pfadanalyse | Zwei moderate Meldungen verbleiben; kein externer Penetrationstest |
| Browser und mobile Bedienung | BESTANDEN | 11 automatisierte Chromium-Tests, Desktop/mobile Viewports | Kein manueller Gerätetest; keine vollständige Browsermatrix |

**Bewertung: BEDINGT FREIGABEFÄHIG.** Die geprüften Integritätsmechanismen bestehen;
für eine vollständige Freigabe fehlen der reale Android-/DAVx⁵-Test mit der
vorgesehenen Kontakte-App sowie die umgebungsspezifische Backup-/Restore-Abnahme.
Die zwei verbleibenden Audit-Meldungen müssen mit der dokumentierten begrenzten
Erreichbarkeitsbewertung bewusst akzeptiert oder später durch geprüfte Updates
beseitigt werden. Keine pauschale Sicherheits- oder Kompatibilitätsfreigabe.

### Protokoll des abschließenden lokalen Laufs

| Kommando | Ergebnis |
| --- | --- |
| `npm ci` | BESTANDEN; Lockfile unverändert |
| `npm test` | BESTANDEN, 69/69, kein Skip |
| `npm run test:browser` | BESTANDEN, 11/11 |
| `npm run test:baikal` mit isoliertem Release | BESTANDEN, 1 Integrationstest, kein Skip |
| `npm run test:postgres` | BESTANDEN, vollständige native Szenarienfolge oben, kein Skip |
| `npm run build` | BESTANDEN, API und Web |
| `tsc --noEmit` für API/Web und zusätzliche Integrationsdateien | BESTANDEN |
| `npm audit` | TEILWEISE GEPRÜFT: Exit 1, zwei moderate Meldungen, null hoch/kritisch; Pfadbewertung oben |
| `git diff --check` | BESTANDEN |

GitHub-CI des geprüften Code-/Workflow-Stands `72bd0d8`: **BESTANDEN**,
[Integrity tests #16](https://github.com/skords83/frigg/actions/runs/45017745905).
Bestätigt sind alle vorhandenen Prüfungen und die neue native PostgreSQL-16-Suite
(kein Skip). Der nachfolgende Commit ergänzt ausschließlich diesen Nachweis in
der Dokumentation; Anwendungscode und Tests bleiben identisch.

CI-Erstlauf der Ergänzungen [#14](https://github.com/skords83/frigg/actions/runs/44995940181):
alle bisherigen Prüfungen bestanden, native Suite noch nicht gestartet. Ursache:
`ubuntu-latest` lieferte Ubuntu 26.04 ohne PostgreSQL-16-Paket. Der Test-Runner
ist deshalb auf Ubuntu 24.04 mit PostgreSQL 16 fixiert; kein Anwendungsfehler.
Auch die unveränderten Heads von PR #1–#4 haben erfolgreiche CI-Läufe (#2/#4/#6/#8).

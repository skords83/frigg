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

# Gezieltes API-Release: vCard-Leerzeilen

Basis: `main` = `08617320ab847e8ab307d7f8f78595e8e27cfe71`.
Release-Branch: `release/vcard-empty-lines`.
Quelle: `df3ada9e43e25f4ac6ea7d548a39d587752afe55` aus Draft-PR #6.

Exakter geplanter Image-Tag:

```
ghcr.io/skords83/frigg-api:v0.1.0-vcard-empty-lines.20261122.1
```

Noch nicht veröffentlicht. Der erfolgreiche manuelle Build liefert zusätzlich
den unveränderlichen SHA-256-Digest und die gebaute Git-SHA im Actions-Summary.
Für Dockhand vorzugsweise `ghcr.io/skords83/frigg-api@sha256:…` daraus verwenden.

## Umfang und Abhängigkeiten

Nur `readDocument()` und der sekundäre `VCF.parse()`-Aufruf werden angepasst:
erst entfalten, danach ausschließlich leere logische Zeilen überspringen.
Whitespace, leere Property-Werte und Faltungen bleiben erhalten; gespeicherte
`raw_vcard` und unveränderte Patches bleiben bytegleich. Tatsächliche lokale
Dokumentedits serialisieren ignorierte Leerzeilen nicht wieder.

Die vorausgehenden Diagnosecommits `a3cd82f` und `843af98` sind nicht nötig.
Keine Diagnose-Endpunkte, Diagnoseprogramme oder neuen Fehlerklassen übernommen.
Die bisherigen `DavError`-Codes und die null-Rückgabe des Parsers bleiben erhalten.
Regressionen prüfen vCard 3/4, LF/CRLF, Faltungen, Whitespace, leere Werte,
Rohdatenerhalt, Full-/Delta-Sync mit gemockten Backends und strikte Ablehnungen.
Der bereits erfolgreiche produktive Lesetest (122/122, null Fehler, unveränderte
Marker) stammt aus der Ausgangslage; hier wird er nicht erneut ausgeführt.

## Schema 005/006: Voraussetzung, keine Aktion dieses Releases

Beide Migrationen sind unverändert in `main` enthalten. 005 führt `vcard_uid`,
den buchbezogenen Unique-Index und `contact_operations` ein; 006 ergänzt
`resource_kind` und setzt bei Ausführung Synchronisierungsmarker zurück.
Der Parserfix benötigt keine neue Migration. Insbesondere 006 nicht wiederholen.
API-Image und API-Start führen diese SQL-Dateien nicht automatisch aus;
Compose-Init-Skripte greifen nur bei initialem PostgreSQL-Datenverzeichnis.

Vor späterem API-Start den bereits vorhandenen Produktions-Schemastand anhand
der Betriebsdokumentation bzw. ausschließlich lesender Schema-Prüfung bestätigen.
Die Existenz der SQL-Dateien beweist keine produktive Anwendung. Falls 005/006
fehlen: Start stoppen und separat behandeln, nicht im Rahmen dieses Releases
migrieren. Keine DB-Verbindung oder Schemaänderung gehört zur Vorbereitung.

## Veröffentlichung ohne Merge

Der neue Workflow `.github/workflows/api-parser-release.yml` validiert bei Push
nur diesen Release-Branch: API-Tests, TypeScript und Docker-Build ohne Push/Start.
Nur `workflow_dispatch` erlaubt dem separaten Publish-Job `packages: write`.
Es gibt genau einen festen API-Tag, keine Metadaten-Automatik für `latest`,
keinen Web-Build und keinen Deployment-Schritt im neuen Workflow. Der bestehende
Integrity-Workflow kann unabhängig davon weiterhin Web-Tests/Builds ausführen.

Der erste Push-Lauf registriert den neuen Workflow ohne Änderung an `main`.
Nach erfolgreichem Lauf kann er per ID/CLI auf demselben Branch manuell gestartet
werden; der UI-Button erfordert gegebenenfalls die Datei im Default-Branch.
Siehe [GitHub: workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

Erst nach Prüfung des Draft-PR und Freigabe zur Veröffentlichung ausführen:

```sh
gh workflow run api-parser-release.yml --repo skords83/frigg --ref release/vcard-empty-lines
```

Vorher Branch-SHA gegen den geprüften Stand vergleichen. Workflow-Run und Summary
kontrollieren. Ein vorhandener Release-Tag führt zum Abbruch; Registry-/Authfehler
werden nicht als freie Tags behandelt. Bei notwendigem Neubau einen neuen,
reviewten Versions-Tag verwenden. Diese Sperre serialisiert diesen Workflow;
GHCR-Tags sind nicht generell unveränderlich, daher anschließend Digest pinnen.
**Niemals `docker-publish.yml` manuell starten:** Dieser überschreibt API/Web-latest.

## Dockhand: spätere, gesondert freizugebende Aktualisierung

1. Produktive API gestoppt lassen. In Dockhand den tatsächlich bestehenden Frigg-
   Stack auf Sleipnir identifizieren. Compose-Konfiguration und bisherigen
   Container/Image-Stand sichern; keine Geheimnisse in PR oder Logs kopieren.
2. Vor jedem Pull die Image-ID des gestoppten bisherigen API-Containers, dessen
   RepoDigest und Git-/Release-Stand festhalten. Das lokale Image mit eindeutigem
   Rollback-Tag sichern und bei Bedarf als Image-Archiv exportieren. Kein Prune.
   `latest` ist kein belastbarer Rollback-Verweis und kann schon auf einen anderen
   Build zeigen. Bisherige Compose-Konfiguration mit dem alten Digest erhalten.
3. Schema-Voraussetzungen 005/006 und Kompatibilität des alten Images bestätigen.
   Ein Image vor Migration 005 darf nicht schreibend auf das neue Schema zurück.
   Bei unbekannter Kompatibilität besteht der sichere Rückfall im gestoppten API-
   Zustand; ein Code-Rollback macht zwischenzeitliche Datenänderungen nicht rückgängig.
4. Nur `services.api.image` im aktiven Dockhand-Stack auf den verifizierten neuen
   Digest umstellen. Web, DB, Volumes, Netzwerke und Umgebungswerte beibehalten.
   Nur das API-Image ziehen. Kein vollständiges Stack-Update und kein Pull von
   Web/latest; kein DB-Recreate und keine Migration.
5. Erst bei gesonderter Betriebsfreigabe ausschließlich API neu erstellen/starten.
   Falls Dockhand keine servicebezogene Aktion anbietet, nicht „gesamten Stack
   redeployen“, sondern die konkrete Bedienung vorher klären. Ein CLI-Fallback
   muss den existierenden Compose-Projektnamen und die bestätigte Konfigurations-
   datei verwenden: `docker compose ... up -d --no-deps api`.
   API-Start führt Bootstrap und sofortigen Sync aus; er ist kein lesender Test.
6. `/healthz`, API-Logs und Sync-Ergebnis beobachten. Bei Problemen API stoppen,
   gesicherten kompatiblen alten Digest in Dockhand wieder eintragen und nur nach
   Prüfung erneut starten; andernfalls API gestoppt lassen. Keine Marker-Resets.

Keiner dieser Produktionsschritte wurde in der Release-Vorbereitung ausgeführt.

## Warum VPS gegenüber Sleipnir?

Git belegt: Schon `31c740e` (erster CI/CD-Workflow) nennt den SSH-Schritt „Sleipnir“,
verwendet aber `stacks/VPS/frigg`. `bb1f57f` ergänzt den Kopierschritt;
`b073f77` stellt auf `compose.yaml` um und behält den VPS-Pfad bei. Aktuell sind
SCP-Ziel und SSH-STACK gleichermaßen auf VPS festgelegt. Es gibt keine automatische
Ableitung aus Dockhand oder Compose-Labels und keine Pfad-Migration in diesem Repo.

Der von der aktuellen Installation gemeldete Pfad `stacks/Sleipnir/frigg` weicht
also von einer historischen, hart codierten Workflow-Annahme ab. Ob Dockhand
umbenannt/neu angelegt wurde oder ein Symlink besteht, ist ohne lesenden Zugriff
auf den Host nicht bewiesen. Vor einer späteren Deployment-Reparatur nur lesend
`com.docker.compose.project.working_dir`, `project.config_files`, Projektname,
Dockhands Stack-Zuordnung sowie `readlink -f`/Dateistatus beider Pfade vergleichen.
Nicht probeweise in VPS deployen: Es könnte den falschen Stack bedienen oder
parallel einen Stack mit abweichenden Volumes anlegen. Bestehendes Deployment und
Compose bleiben in diesem PR unverändert.

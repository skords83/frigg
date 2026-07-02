# Product

## Register

product

## Users

Skords, managing personal and household contacts self-hosted at `contacts.skords.de`, synced against a Baïkal CardDAV server. Single primary user (possibly extended to household members), used in short focused sessions: looking someone up, fixing a phone number, merging a duplicate after a DAVx5 sync, adding someone new. Not a team tool, not multi-tenant — no onboarding funnel, no seat management, no "invite your team."

## Product Purpose

Frigg is a macOS Contacts-style web app that gives a self-hosted CardDAV address book (Baïkal) a fast, good-looking home. It exists because stock CardDAV clients and generic address-book UIs are either barebones or corporate-flat, and this address book is personal enough to deserve better. Success looks like: contacts are quick to find and fix, edits round-trip safely to the CardDAV source without corrupting unknown vCard fields, and the app feels like a well-kept personal ledger rather than a directory tool.

## Brand Personality

**Heraldic & archival.** The app treats a contact record like an entry in a well-kept ledger — wax-seal avatars, a brass-gold accent against deep forest tones, serif display type (Fraunces) paired with plain-spoken IBM Plex Sans/Mono for data. It's personal correspondence made durable, not a corporate directory. Confident and a little ceremonial, but never precious — the ornament (seals, rings, dividers) frames the data, it doesn't compete with it. Voice in copy and empty states should be dry and warm, not chipper or corporate.

## Anti-references

- Generic SaaS/CRM: no corporate blue, no card-grid dashboards, no hero-metric tiles, no "Upgrade to Pro" energy. This is not a business tool.
- Stock address-book apps: should not resemble Google Contacts, Apple Contacts, or Outlook's default flat, generic list-and-form look.
- Anything that reads as a directory of strangers rather than a personal record of people the user actually knows.

## Design Principles

1. **Ornament frames data, it never competes with it.** Seals, rings, dividers, and the gold accent mark structure and hierarchy — the contact's name, number, and notes stay the loudest thing on screen.
2. **Roundtrip safety is a design constraint, not just a backend concern.** Any editing UI must make it clear when a field is a known, structured one (name, phone, email) versus raw vCard data being preserved untouched — never let the interface imply more control over a contact's data than the sync layer actually has.
3. **Fast lookup over feature surface.** This is opened to find or fix one person, quickly — prioritize search, keyboard navigation, and list scanability over adding chrome.
4. **Personal, not administrative.** Copy, empty states, and error messages should sound like a careful correspondent, not a system administrator. Dry warmth over corporate cheerfulness or terse technical error codes.
5. **Restraint on motion and density.** The heraldic aesthetic earns its ornament through precision (thin dividers, subtle seal rings, calm entrance transitions), not through decoration piled on top of decoration.

## Accessibility & Inclusion

Standard WCAG AA baseline: body text ≥4.5:1 contrast against the dark forest background, visible focus states throughout (modals, list rows, form fields), full keyboard navigation for search/select/edit flows, and `prefers-reduced-motion` alternatives for all entrance/press animations (already partially in place in `globals.css`). No known special accommodations beyond that baseline today.

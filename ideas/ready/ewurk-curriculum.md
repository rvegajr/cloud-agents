# EWURK class curriculum

## One sentence
A Saturday class curriculum that matches what EWURK already tracks: one
session, a roster from active leases, present or absent.

## The problem
`Worthless-Haunted-Meat/ewurk` can create a class session, roster every
family on an active lease, and mark attendance. The nonprofit still has no
written lesson to teach. Solved feels like: an instructor opens the week's
session in EWURK, prints or reads a one-page lesson, teaches it, and marks
the roster. The curriculum is the content; EWURK stays the attendance book.

## Must have (v1)
- A sequence of lessons sized for a 60–90 minute Saturday class with mixed
  ages using the Linux desktops the program leases (browser, files, typing,
  staying safe online). Assume the EWURK Linux image, not Windows.
- Each lesson: goal, materials, 3–5 steps, a 10-minute fallback if the
  room is chaotic, and what “done” looks like for the instructor.
- Lessons numbered so a session title in EWURK can match (e.g. “Lesson 3 —
  files and folders”).
- GPL-3.0. English first. No family PII in the materials.
- A short instructor README: how this repo relates to EWURK attendance
  (roster comes from leases; this repo does not log attendance).

## I will judge it by
- An instructor who is not a teacher can run Lesson 1 from the page without
  another document.
- Ten lessons exist covering first-month Saturdays, not a 40-week school year.
- Nothing in the materials asks for SSN, income, or a child’s full school record.

## Wrong looks like
- A second attendance app. EWURK already has classes.
- Curriculum that requires licensed Windows or paid SaaS classroom tools.
- Lessons that assume home broadband or a parent who is a developer.

## Must not change
- Do not modify `Worthless-Haunted-Meat/ewurk` unless a lesson title
  convention is documented only (no schema change required for v1).
- No lessee login, no grading database, no lockout for missed class.

## Nice to have (later)
- Spanish.
- Homework sheets.
- Mapping lesson ids into EWURK session metadata.

## Shape
- New repo under Worthless-Haunted-Meat, e.g. `ewurk-curriculum`.
- Markdown lessons plus a simple index. A static HTML build is fine if tests
  check that every lesson file is linked and has the required headings.
- No paid services, no accounts, no secrets.

## Example
Saturday 10 a.m.: instructor creates a session in EWURK titled “Lesson 2 —
browser basics,” teaches from `lessons/02-browser.md`, marks Herrera present
and Osei absent, and goes home. Next Saturday they open Lesson 3.

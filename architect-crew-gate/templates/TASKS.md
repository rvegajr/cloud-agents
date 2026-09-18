# Tasks

<!-- Ordered units of work, one per crew turn. `Files:` is the complete list a task
     may write and the gate enforces it. `Parallel: yes` only when the task shares
     no file with, and changes no port used by, any other parallel task. One task
     is a valid file (a repair). See PATTERN.md section 2.5. -->

## T1: <title>
Requirements: R1
Files: <path>, <path>
Ports: <PortName>
Tests: <test path>
Commands: <test command for this task>, <lint command>
Parallel: no
Out of scope: <what this task must not touch>
Goal: <one sentence>.

```json tasks
{ "tasks": [
  { "id": "T1", "title": "", "requirements": ["R1"], "files": [""], "ports": [""],
    "tests": [""], "commands": [""], "parallel_ok": false }
]}
```

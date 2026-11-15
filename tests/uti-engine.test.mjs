import test from "node:test";
import assert from "node:assert/strict";
import { simulateUtiPreview } from "../uti-engine.mjs";

const post = (code, sequence, extra = {}) => ({ code, name: code, post_type: "bed", sequence, ...extra });
const person = (id, weekly_hours = 30) => ({ id, nome: id, masp: id, weekly_hours, active: true });
const marker = (id, day = "2026-12-01", code = "X", status = "available") => ({
  staff_id: id, work_date: day, original_marker: code, availability_status: status
});

test("only confirmed X from linked active professionals can be allocated", () => {
  const result = simulateUtiPreview({
    staff: [person("A"), person("B"), { ...person("C"), active: false }],
    linkedStaffIds: ["A", "B", "C"],
    availability: [marker("A"), marker("B", "2026-12-01", "FR", "leave"), marker("C")],
    targets: ["A", "B", "C"].map(staff_id => ({ staff_id, expected_shifts: 5 })),
    posts: [post("P1", 1)],
    competence: "2026-12-01",
  });
  assert.equal(result.days[0].assignments[0].staff_id, "A");
});

test("REM is reported separately and never occupies a post", () => {
  const result = simulateUtiPreview({
    staff: [person("A")], linkedStaffIds: ["A"],
    availability: [marker("A", "2026-12-01", "REM", "rem")],
    targets: [{ staff_id: "A", expected_shifts: 5 }],
    posts: [post("P1", 1)], competence: "2026-12-01",
  });
  assert.equal(result.days[0].rem.length, 1);
  assert.equal(result.days[0].assignments[0].staff_id, null);
});

test("40-hour staff without explicit continuity rule is held for manual review", () => {
  const result = simulateUtiPreview({
    staff: [person("A", 40)], linkedStaffIds: ["A"],
    availability: [marker("A")],
    targets: [{ staff_id: "A", expected_shifts: 10, weekly_hours_snapshot: 40 }],
    posts: [post("P1", 1)], competence: "2026-12-01",
  });
  assert.equal(result.days[0].assignments[0].staff_id, null);
  assert.equal(result.days[0].manual_candidates[0].staff_id, "A");
});

test("a unique ONLY_POST_CODE rule assigns the person to that post", () => {
  const result = simulateUtiPreview({
    staff: [person("A")], linkedStaffIds: ["A"],
    availability: [marker("A")],
    targets: [{ staff_id: "A", expected_shifts: 10 }],
    posts: [post("P1", 1), post("P2", 2)],
    rules: [{ staff_id: "A", rule_code: "ONLY_POST_CODE", rule_value: "P2", unit_code: "UTI_ADULTO" }],
    competence: "2026-12-01",
  });
  assert.equal(result.days[0].assignments.find(x => x.post_code === "P2").staff_id, "A");
  assert.equal(result.days[0].assignments.find(x => x.post_code === "P1").staff_id, null);
});

test("duplicate daily rows prevent allocation and are reported", () => {
  const result = simulateUtiPreview({
    staff: [person("A")], linkedStaffIds: ["A"],
    availability: [marker("A"), marker("A")],
    targets: [{ staff_id: "A", expected_shifts: 10 }],
    posts: [post("P1", 1)], competence: "2026-12-01",
  });
  assert.equal(result.days[0].assignments[0].staff_id, null);
  assert.match(result.days[0].notes.join(" "), /mais de uma marcação/);
});

import { describe, it, expect } from 'vitest';
import { parseAdl, assertionTargets, textHash } from '../spec/adl-parse.js';

const ADL = `DESCRIPTION Make the Grade data
CATEGORY Data
NAMESPACE MtgNS
DEFINE CONST MAX_DEPTH = 3
DEFINE SYSTEM Make the Grade AS mtg
    DEFINE DATABASE Test Database AS test-db
    DEFINE DOMAIN Testing AS testing
        DEFINE COMPONENT Answer Capture AS answercapture
    DEFINE DOMAIN Grading AS grading
        DEFINE SERVICE Grading Service AS grading-service

DEFINE COMMUNICATION Testing Service TO Grading Service AS asynchronous
DEFINE SAGA Answer Grading Saga AS
    DEFINE COORDINATION Choreography

# Answer keys stay with grading
ASSERT(Test Database is only accessed by Answer Capture) # [MTG-1]
ASSERT(Grading Service makes no synchronous call)
FOREACH COMPONENT c IN mtg DO
    ASSERT(depth of c < MAX_DEPTH) # [MTG-2]
END
WITHIN something unknown
`;

describe('ADL parser', () => {
  const doc = parseAdl(ADL);

  it('reads the header and constants', () => {
    expect(doc).toMatchObject({ description: 'Make the Grade data', category: 'Data', namespace: 'MtgNS' });
    expect(doc.constants).toEqual({ MAX_DEPTH: '3' });
  });

  it('builds element IDs from the nesting, with the system as namespace', () => {
    expect(doc.elements.map((e) => e.elementId)).toEqual([
      'adl:mtg', 'adl:test-db', 'adl:testing', 'adl:testing.answercapture', 'adl:grading', 'adl:grading.grading-service', 'adl:answer-grading-saga',
    ]);
    expect(doc.elements.find((e) => e.id === 'answercapture')!.parent).toBe('adl:testing');
  });

  it('reads assertions with tags, comments, FOREACH scope and a stable ID when untagged', () => {
    const [a1, a2, a3] = doc.assertions;
    expect(a1).toMatchObject({ id: 'MTG-1', tagged: true, comment: 'Answer keys stay with grading' });
    expect(a2!.id).toBe(`A-${textHash('Grading Service makes no synchronous call')}`);
    expect(a2!.tagged).toBe(false);
    expect(a3).toMatchObject({ id: 'MTG-2', scope: 'FOREACH COMPONENT c IN mtg' });
  });

  it('keeps communications and unknown lines instead of failing', () => {
    expect(doc.communications).toEqual([{ from: 'Testing Service', to: 'Grading Service', style: 'asynchronous', line: 12 }]);
    expect(doc.other.map((o) => o.text)).toEqual(['WITHIN something unknown']);
    expect(doc.elements.find((e) => e.kind === 'SAGA')!.properties).toEqual({ COORDINATION: 'Choreography' });
  });

  it('links an assertion to the elements it names, and a FOREACH assertion to every element of that kind', () => {
    expect(assertionTargets(doc.assertions[0]!, doc.elements).sort()).toEqual(['adl:test-db', 'adl:testing.answercapture']);
    expect(assertionTargets(doc.assertions[2]!, doc.elements)).toEqual(['adl:testing.answercapture']);
  });
});

describe('spec-driven-workflow skill templates', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.resolve(__dirname, '..', '..', 'skills', 'spec-driven-workflow', 'templates');

  it('the starter ADL parses with tagged assertions and no unknown lines', () => {
    const doc = parseAdl(fs.readFileSync(path.join(dir, 'starter.adl.template'), 'utf8'));
    expect(doc.assertions.every((a) => a.tagged)).toBe(true);
    expect(doc.other).toEqual([]);
  });
});

describe('ADL value definitions', () => {
  const doc = parseAdl(`TYPE operational
CAPABILITY scalability
DEFINE SYSTEM Make the Grade AS mtg
    DEFINE SERVICE Answer Capture AS answer-capture
    DEFINE SERVICE Auto Grading AS auto-grading
    DEFINE PERSON Alex AS alex@mtg.example
        ASSIGN ROLE Reporting Developer
        ASSIGN ROLE Administration Developer
DEFINE CAPABILITY Responsiveness AS p95 < 300ms FOR Answer Capture
DEFINE CAPABILITY Maintainability AS {
    Maintainability Level > 60%,
    Cyclomatic Complexity < 4 }
DEFINE CONTRACT answer-message BETWEEN {Answer Capture, Auto Grading} AS NAME-VALUE-PAIRS
    including {student-id, answer}
DEFINE TEAM Graders AS Stream-Aligned Team
    ASSIGN DOMAIN GradingNS.Auto Grading
DEFINE STYLE Make the Grade Architecture AS Service Based
ASSERT(Conditions defined by Maintainability are met)
`);

  it('reads TYPE and the CAPABILITY header', () => {
    expect(doc).toMatchObject({ type: 'operational', capability: 'scalability' });
  });

  it('records capabilities, blocks, contracts and styles as definitions, not elements', () => {
    expect(doc.elements.map((e) => e.elementId)).toEqual(['adl:mtg', 'adl:answer-capture', 'adl:auto-grading', 'adl:alex-mtg-example']);
    expect(doc.definitions).toEqual([
      { kind: 'CAPABILITY', name: 'Responsiveness', value: 'p95 < 300ms', targets: ['adl:answer-capture'], line: 9 },
      { kind: 'CAPABILITY', name: 'Maintainability', value: 'Maintainability Level > 60%, Cyclomatic Complexity < 4', targets: [], line: 10 },
      { kind: 'CONTRACT', name: 'answer-message', value: 'NAME-VALUE-PAIRS; including {student-id, answer}', targets: ['adl:answer-capture', 'adl:auto-grading'], line: 13 },
      { kind: 'TEAM', name: 'Graders', value: 'Stream-Aligned Team; ASSIGN DOMAIN GradingNS.Auto Grading', targets: ['adl:auto-grading'], line: 15 },
      { kind: 'STYLE', name: 'Make the Grade Architecture', value: 'Service Based', targets: [], line: 17 },
    ]);
    expect(doc.assertions).toHaveLength(1);
    expect(doc.other).toEqual([]);
    expect(doc.elements.find((e) => e.id === 'alex-mtg-example')!.properties).toEqual({ 'ASSIGN ROLE': 'Reporting Developer; Administration Developer' });
  });
});

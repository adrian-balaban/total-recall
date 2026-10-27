// Reads the parts of a CALM document total-recall indexes: nodes, relationships,
// interfaces and controls. Plain JSON reading only; schema validation stays with
// the CALM CLI (validate_architecture). Leaf module: no local imports.

export interface CalmControl { owner: string; name: string; description: string }
export interface CalmNode { id: string; type: string; name: string; description: string; interfaces: string[]; controls: string[] }
export interface CalmRelationship {
  id: string;
  kind: string;            // connects, interacts, deployed-in, composed-of, options
  nodes: string[];         // every node the relationship touches
  description: string;
  controls: string[];
}
export interface CalmDocument { nodes: CalmNode[]; relationships: CalmRelationship[]; controls: CalmControl[] }

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function controlsOf(owner: string, v: unknown, sink: CalmControl[]): string[] {
  return Object.entries(obj(v)).map(([name, c]) => {
    sink.push({ owner, name, description: s(obj(c).description) });
    return name;
  });
}

function relNodes(kind: string, body: Record<string, unknown>): string[] {
  switch (kind) {
    case 'connects':
      return [s(obj(body.source).node), s(obj(body.destination).node)];
    case 'interacts':
      return [s(body.actor), ...arr(body.nodes).map(s)];
    case 'deployed-in':
    case 'composed-of':
      return [s(body.container), ...arr(body.nodes).map(s)];
    default:
      return [];
  }
}

// Throws on invalid JSON (the caller reports the file); anything else is tolerated.
export function parseCalm(text: string): CalmDocument {
  const root = obj(JSON.parse(text));
  const controls: CalmControl[] = [];
  const nodes = arr(root.nodes).map((n) => {
    const o = obj(n);
    const id = s(o['unique-id']);
    return {
      id,
      type: s(o['node-type']),
      name: s(o.name) || id,
      description: s(o.description),
      interfaces: arr(o.interfaces).map((i) => s(obj(i)['unique-id'])).filter(Boolean),
      controls: controlsOf(`calm:${id}`, o.controls, controls),
    };
  }).filter((n) => n.id);
  const relationships = arr(root.relationships).map((r) => {
    const o = obj(r);
    const id = s(o['unique-id']);
    const type = obj(o['relationship-type']);
    const kind = Object.keys(type)[0] ?? '';
    return {
      id,
      kind,
      nodes: relNodes(kind, obj(type[kind])).filter(Boolean),
      description: s(o.description),
      controls: controlsOf(`calm:${id}`, o.controls, controls),
    };
  }).filter((r) => r.id);
  controlsOf('calm:', root.controls, controls);
  return { nodes, relationships, controls };
}

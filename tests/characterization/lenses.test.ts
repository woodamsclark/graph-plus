import { compileGraphQuery } from '../../src/graph+/lens/GraphQuery.ts';
import { projectGraph } from '../../src/graph+/lens/GraphProjector.ts';
import { createDefaultGraphLens } from '../../src/graph+/types/domain/lens.ts';
import { graph, link, node } from '../support/legacyGraphFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('filter query supports facets, boolean terms, and negation', () => {
  const candidate = node('projects/Alpha.md', 'note', {
    tags: ['work/active'],
    properties: { status: ['active'], owner: ['woody'] },
  });
  equal(compileGraphQuery('tag:#work AND [status:active]').matches(candidate), true, 'tag and property should match');
  equal(compileGraphQuery('path:archive OR [owner:woody]').matches(candidate), true, 'OR should match second branch');
  equal(compileGraphQuery('tag:work -path:projects').matches(candidate), false, 'negated path should exclude');
  assert(compileGraphQuery('(tag:work').error, 'unclosed query should report an error');
});

test('free projection filters without losing source position identity', () => {
  const a = node('A.md', 'note', { x: 37 });
  const tag = node('topic', 'tag');
  const source = graph([a, tag], [link('A.md', 'topic', 1, ['tag'])]);
  const lens = createDefaultGraphLens(false);
  const projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.nodes.length, 1, 'tag should be filtered');
  equal(projected.nodes[0].location, a.location, 'free projection should share canonical position');
  projected.nodes[0].location.x = 51;
  equal(a.location.x, 51, 'physics movement should flow back to canonical graph');
});

test('free projection recomputes adjacency after filtering', () => {
  const source = graph(
    [node('A.md'), node('B.md'), node('topic', 'tag')],
    [link('A.md', 'B.md', 2), link('A.md', 'topic', 1, ['tag'])],
  );
  const projected = projectGraph(source, createDefaultGraphLens(false), { ringSpacing: 100 });
  deepEqual(projected.linksOut, { 'A.md': { 'B.md': 2 } }, 'outgoing adjacency should contain only visible edges');
  deepEqual(projected.linksIn, { 'B.md': { 'A.md': 2 } }, 'incoming adjacency should contain only visible edges');
});

test('orphan filtering is reversible and does not mutate the source graph', () => {
  const source = graph([node('A.md'), node('B.md'), node('orphan.md')], [link('A.md', 'B.md')]);
  const lens = createDefaultGraphLens(false);
  lens.filter.showOrphans = false;
  const withoutOrphan = projectGraph(source, lens, { ringSpacing: 100 });
  equal(withoutOrphan.nodes.some((value) => value.id === 'orphan.md'), false, 'orphan should be absent from projected view');
  equal(source.nodes.some((value) => value.id === 'orphan.md'), true, 'orphan should remain in source graph');
  lens.filter.showOrphans = true;
  const restored = projectGraph(source, lens, { ringSpacing: 100 });
  equal(restored.nodes.some((value) => value.id === 'orphan.md'), true, 'orphan should return when constraint is removed');
});

test('mind-map form is deterministic and distinguishes tree links from cross-links', () => {
  const nodes = ['A.md', 'B.md', 'C.md', 'D.md'].map((id) => node(id));
  const source = graph(nodes, [
    link('A.md', 'B.md'),
    link('A.md', 'C.md'),
    link('B.md', 'D.md'),
    link('C.md', 'D.md'),
  ]);
  const lens = createDefaultGraphLens(false);
  lens.form.mode = 'mind-map';
  lens.form.rootId = 'A.md';
  const first = projectGraph(source, lens, { ringSpacing: 120 });
  const second = projectGraph(source, lens, { ringSpacing: 120 });
  equal(first.projection.rootId, 'A.md', 'requested root should be used');
  equal(first.nodes.find((value) => value.id === 'A.md')?.location.x, 0, 'root should be centered');
  deepEqual(first.nodes.map((value) => value.location), second.nodes.map((value) => value.location), 'radial placement should be stable');
  equal(first.links.filter((value) => value.view?.role === 'tree').length, 3, 'spanning tree should contain three links');
  equal(first.links.filter((value) => value.view?.role === 'cross').length, 1, 'remaining relation should be a cross-link');
  const bColor = first.nodes.find((value) => value.id === 'B.md')?.view?.color;
  const cColor = first.nodes.find((value) => value.id === 'C.md')?.view?.color;
  assert(bColor && cColor && bColor !== cColor, 'top-level branches should receive distinct colors');

  lens.form.maxDepth = 1;
  const shallow = projectGraph(source, lens, { ringSpacing: 120 });
  equal(shallow.nodes.some((value) => value.id === 'D.md'), false, 'depth constraint should hide deeper descendants');
  equal(nodes[0].location.x, 0, 'form projection should not mutate canonical positions');
});

test('mind-map fallback root is stable by weighted degree and ID', () => {
  const source = graph(
    [node('C.md'), node('B.md'), node('A.md')],
    [link('A.md', 'B.md'), link('A.md', 'C.md')],
  );
  const lens = createDefaultGraphLens(false);
  lens.form.mode = 'mind-map';
  lens.form.rootId = 'missing.md';
  const projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.projection.rootId, 'A.md', 'highest weighted degree should win fallback root selection');
});

test('form constraints apply relation, direction, and cross-link visibility', () => {
  const source = graph(
    ['A.md', 'B.md', 'C.md', 'D.md'].map((id) => node(id)),
    [
      link('A.md', 'B.md', 1, ['parent']),
      link('C.md', 'A.md', 1, ['parent']),
      link('A.md', 'D.md', 1, ['reference']),
    ],
  );
  const lens = createDefaultGraphLens(false);
  lens.form.mode = 'mind-map';
  lens.form.rootId = 'A.md';
  lens.form.relation = 'parent';
  lens.form.direction = 'outgoing';
  let projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.nodes.map((value) => value.id).sort().join(','), 'A.md,B.md', 'outgoing relation should select descendants');

  lens.form.direction = 'incoming';
  projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.nodes.map((value) => value.id).sort().join(','), 'A.md,C.md', 'incoming relation should select ancestors');

  lens.form.direction = 'both';
  lens.form.showCrossLinks = false;
  projected = projectGraph(source, lens, { ringSpacing: 100 });
  assert(projected.links.every((value) => value.view?.role === 'tree'), 'cross-links should be removable without changing source data');
});

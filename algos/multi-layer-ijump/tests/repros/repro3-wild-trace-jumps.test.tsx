/**
 * Reproduction test for Issue #92:
 * "Multilayer Ijump: Remove wild trace jumps"
 *
 * Root cause: In MultilayerIjump.getNeighbors(), when overcoming an obstacle
 * (perpendicular travel to get past a wall), the code incorrectly pushes BOTH:
 *   1) The correct overcomeDistance-based node (travel just past the obstacle)
 *   2) A wild-jump wall-distance node (travel all the way to the far wall)
 *
 * The single-layer IJumpAutorouter only ever pushes ONE node per direction,
 * but MultilayerIjump's marginsWithCosts loop also adds extra nodes from the
 * "wall distance" sub-block inside the overcomeDistance branch — causing the
 * router to produce absurdly long trace segments that jump far past the obstacle.
 *
 * Bug location: MultilayerIjump.ts getNeighbors() — the
 * `else if (travelDir.wallDistance > this.largestMargin)` block inside the
 * `overcomeDistance !== null && overcomeDistance < travelDir.wallDistance` branch.
 */

import { Circuit } from "@tscircuit/core"
import { test, expect } from "bun:test"
import { getSimpleRouteJson } from "solver-utils"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { MultilayerIjump } from "algos/multi-layer-ijump/MultilayerIjump"

const BOARD_WIDTH = 20
const BOARD_HEIGHT = 10

const SmtPad = (props: {
  name: string
  pcbX: number
  pcbY: number
  layer: "top" | "bottom"
  width?: number
  height?: number
}) => (
  <chip name={props.name} pcbX={props.pcbX} pcbY={props.pcbY}>
    <footprint>
      <smtpad
        pcbX={0}
        pcbY={0}
        shape="rect"
        width={`${props.width ?? 1}mm`}
        height={`${props.height ?? 1}mm`}
        layer={props.layer}
        portHints={["pin1"]}
      />
    </footprint>
  </chip>
)

test("repro: wild trace jumps in multilayer obstacle bypass (Issue #92)", () => {
  /**
   * Layout (top view, board 20mm x 10mm):
   *
   *  U1(top)   [=== U_block (4mm x 8mm, top layer) ===]   U2(bottom)
   *   (-7,0)                   (0,0)                          (7,0)
   *
   * The route from U1→U2 must:
   *   1. Travel right on top layer
   *   2. Hit U_block and detour around it (up or down)
   *   3. Place a via to switch to bottom layer
   *   4. Continue to U2 on bottom layer
   *
   * BUG (before fix): While detouring around U_block vertically, the router
   * creates a "wild jump" — a trace segment that shoots 8+ mm perpendicular
   * instead of the ~2.5mm needed to clear the obstacle, often going outside
   * the board bounds entirely.
   */
  const circuit = new Circuit()

  circuit.add(
    <board
      width={`${BOARD_WIDTH}mm`}
      height={`${BOARD_HEIGHT}mm`}
      routingDisabled
    >
      <SmtPad name="U1" pcbX={-7} pcbY={0} layer="top" />
      <SmtPad name="U2" pcbX={7} pcbY={0} layer="bottom" />
      {/* Wide obstacle on top layer forces the trace to detour vertically */}
      <SmtPad name="U_block" pcbX={0} pcbY={0} layer="top" width={4} height={8} />
      <trace from=".U1 > .pin1" to=".U2 > .pin1" />
    </board>,
  )

  const circuitJson = circuit.getCircuitJson()
  const input = getSimpleRouteJson(circuitJson, { layerCount: 2 })

  const autorouter = new MultilayerIjump({
    input,
    VIA_COST: 1,
    isRemovePathLoopsEnabled: true,
  })

  const solution = autorouter.solveAndMapToTraces()

  // Must produce a complete solution
  expect(solution).toHaveLength(1)

  const pcbTrace = solution[0]
  const wirePoints = pcbTrace.route.filter(
    (p) => p.route_type === "wire",
  ) as Array<{
    x: number
    y: number
    layer: string
    route_type: "wire"
    width: number
  }>

  expect(wirePoints.length).toBeGreaterThan(0)

  // ── Wild Jump Detection ──────────────────────────────────────────────────
  // The board diagonal is ~22.4mm. Any single wire segment longer than 15mm
  // is a "wild jump" — the router overshot the obstacle-avoidance point.
  const MAX_SANE_SEGMENT_MM = 15

  const wildJumps: Array<{
    from: { x: number; y: number }
    to: { x: number; y: number }
    length: number
  }> = []

  for (let i = 0; i < wirePoints.length - 1; i++) {
    const a = wirePoints[i]
    const b = wirePoints[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > MAX_SANE_SEGMENT_MM) {
      wildJumps.push({ from: a, to: b, length: len })
    }
  }

  // Any route point outside the board bounds also signals a wild jump
  const outOfBounds = wirePoints.filter(
    (p) =>
      Math.abs(p.x) > BOARD_WIDTH / 2 + 1 ||
      Math.abs(p.y) > BOARD_HEIGHT / 2 + 1,
  )

  if (wildJumps.length > 0 || outOfBounds.length > 0) {
    console.log("=== WILD JUMP DETECTED ===")
    console.log(`Route: ${wirePoints.length} wire points`)
    for (const j of wildJumps) {
      console.log(
        `  Segment: (${j.from.x.toFixed(2)}, ${j.from.y.toFixed(2)}) → ` +
          `(${j.to.x.toFixed(2)}, ${j.to.y.toFixed(2)})  length=${j.length.toFixed(2)}mm`,
      )
    }
    for (const p of outOfBounds) {
      console.log(`  Out of bounds: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`)
    }
  }

  // These assertions FAIL before the fix, PASS after the fix
  expect(
    wildJumps.length,
    `${wildJumps.length} wild-jump segment(s) found — router overshoots obstacle avoidance`,
  ).toBe(0)

  expect(
    outOfBounds.length,
    `${outOfBounds.length} point(s) outside board bounds — wild jump escaped the board`,
  ).toBe(0)

  // Snapshot for visual review
  expect(
    convertCircuitJsonToPcbSvg(circuitJson.concat(solution as any) as any),
  ).toMatchSvgSnapshot(import.meta.path)
})

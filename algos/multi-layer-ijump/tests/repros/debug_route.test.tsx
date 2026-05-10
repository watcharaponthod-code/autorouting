import { test, expect } from "bun:test"
import { MultilayerIjump } from "algos/multi-layer-ijump/MultilayerIjump"
import { ObstacleList3d } from "algos/multi-layer-ijump/ObstacleList3d"

test("getNeighbors: detect wild-jump nodes in overcomeDistance branch (Issue #92)", () => {
  /**
   * Setup:
   *   Node at (0,0) layer=0, forwardDir=right, obstacleHit=rightWall
   *   rightWall: center=(2.5,0), w=1, h=4 → right edge at x=3, top at y=2, bottom at y=-2
   *     overcomeDistance going UP = (0 + 2) - 0 + 0.15 = 2.15mm
   *   ceiling: center=(0,7), w=20, h=2 → bottom at y=6
   *     wallDistance going UP = 6 - 0 = 6mm
   *
   * BUG: when overcomeDistance(2.15) < wallDistance(6.0), the buggy branch also
   * pushes a node at travelDistance = wallDistance - margin = 6 - 0.15 = 5.85mm (WILD JUMP)
   * instead of only the correct 2.15mm (overcome) node.
   */
  const rightWall = {
    type: "rect" as const, center: { x: 2.5, y: 0 }, width: 1, height: 4,
    layers: ["top" as any], connectedTo: [],
  }
  const ceiling = {
    type: "rect" as const, center: { x: 0, y: 7 }, width: 20, height: 2,
    layers: ["top" as any], connectedTo: [],
  }

  const input = {
    obstacles: [rightWall, ceiling],
    connections: [{
      name: "trace1",
      pointsToConnect: [
        { x: -5, y: 0, layer: "top" as any },
        { x: 10, y: 0, layer: "top" as any },
      ],
    }],
    bounds: { minX: -10, maxX: 15, minY: -10, maxY: 15 },
    layerCount: 2,
    minTraceWidth: 0.1,
  }

  const autorouter = new MultilayerIjump({ input, OBSTACLE_MARGIN: 0.15 })
  autorouter.obstacles = new ObstacleList3d(2, [rightWall, ceiling])

  const startNode: any = {
    x: -5, y: 0, l: 0, g: 0, h: 0, f: 0,
    manDistFromParent: 0, nodesInPath: 0, parent: null,
  }
  const parentNode: any = {
    x: -5, y: 0, l: 0, g: 0, h: 0, f: 0,
    manDistFromParent: 0, nodesInPath: 0, parent: null,
  }
  autorouter.startNode = startNode
  autorouter.goalPoint = { x: 10, y: 0, l: 0 } as any

  // This node just hit rightWall going right
  const node: any = {
    x: 0, y: 0, l: 0,
    g: 5, h: 10, f: 15,
    manDistFromParent: 5,
    nodesInPath: 1,
    obstacleHit: rightWall,
    parent: parentNode,
  }

  const neighbors = (autorouter as any).getNeighbors(node)

  console.log("All neighbors:")
  for (const n of neighbors) {
    console.log(`  (x=${n.x?.toFixed(3)}, y=${n.y?.toFixed(3)}, l=${n.l})`)
  }

  // Collect upward (y > 0) neighbor positions
  const upYs = neighbors
    .filter((n: any) => n.y > 0.01 && Math.abs(n.x) < 0.01 && n.l === 0)
    .map((n: any) => parseFloat(n.y.toFixed(3)))

  console.log(`Upward neighbor Y positions: ${upYs}`)
  console.log(`Expected correct range: 1.0–2.5 (overcome range with margins)`)
  console.log(`Wild jump threshold: Y > 3.0 (ceiling is at Y=6)`)

  // Bug: y > 3.0 means wild jump (router jumped more than needed to overcome obstacle)
  const wildJumps = upYs.filter((y: number) => y > 3.0)
  console.log(`Wild jump nodes: ${wildJumps}`)

  // BEFORE FIX: wildJumps will contain [5.0, 5.85] — nodes near the ceiling
  // AFTER FIX: wildJumps will be empty
  expect(wildJumps.length,
    `Bug confirmed: ${wildJumps.length} wild-jump node(s) at Y=${wildJumps} ` +
    `(correct overcomeDistance is ~2.15mm, ceiling is 6mm away)`
  ).toBe(0)
})

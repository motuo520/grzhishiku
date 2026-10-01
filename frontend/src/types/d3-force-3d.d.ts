// d3-force-3d 无官方类型包（@types/d3-force-3d 不存在，包内也不带 .d.ts），
// 这里只声明 3D 星系视图用到的最小 API 面，与 d3-force 同构、多出 z 维度。
declare module 'd3-force-3d' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum<N extends SimulationNodeDatum> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
  }

  export interface Force<N extends SimulationNodeDatum> {
    (alpha: number): void;
    initialize?: (nodes: N[], random: () => number) => void;
  }

  export interface ForceLink<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>> extends Force<N> {
    links(): L[];
    links(links: L[]): this;
    id(): (node: N, i: number, nodes: N[]) => string | number;
    id(id: (node: N, i: number, nodes: N[]) => string | number): this;
    distance(): (link: L, i: number, links: L[]) => number;
    distance(distance: number | ((link: L, i: number, links: L[]) => number)): this;
    strength(): (link: L, i: number, links: L[]) => number;
    strength(strength: number | ((link: L, i: number, links: L[]) => number)): this;
  }

  export interface ForceManyBody<N extends SimulationNodeDatum> extends Force<N> {
    strength(): (node: N, i: number, nodes: N[]) => number;
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this;
    distanceMax(): number;
    distanceMax(distance: number): this;
    theta(): number;
    theta(theta: number): this;
  }

  export interface ForceCollide<N extends SimulationNodeDatum> extends Force<N> {
    radius(): (node: N, i: number, nodes: N[]) => number;
    radius(radius: number | ((node: N, i: number, nodes: N[]) => number)): this;
    strength(): number;
    strength(strength: number): this;
  }

  export interface ForceX<N extends SimulationNodeDatum> extends Force<N> {
    x(): (node: N, i: number, nodes: N[]) => number;
    x(x: number | ((node: N, i: number, nodes: N[]) => number)): this;
    strength(): number;
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this;
  }

  export interface ForceY<N extends SimulationNodeDatum> extends Force<N> {
    y(): (node: N, i: number, nodes: N[]) => number;
    y(y: number | ((node: N, i: number, nodes: N[]) => number)): this;
    strength(): number;
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this;
  }

  export interface ForceZ<N extends SimulationNodeDatum> extends Force<N> {
    z(): (node: N, i: number, nodes: N[]) => number;
    z(z: number | ((node: N, i: number, nodes: N[]) => number)): this;
    strength(): number;
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this;
  }

  export interface ForceCenter<N extends SimulationNodeDatum> extends Force<N> {
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
  }

  export interface Simulation<N extends SimulationNodeDatum> {
    tick(iterations?: number): this;
    restart(): this;
    stop(): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    force(name: string): Force<N> | undefined;
    force<F extends Force<N>>(name: string, force: F | null): this;
    find(x: number, y: number, z?: number, radius?: number): N | undefined;
    randomSource(): () => number;
    randomSource(source: () => number): this;
    on(typenames: string, listener?: (this: this) => void): this;
    numDimensions(): number;
    numDimensions(dimensions: 1 | 2 | 3): this;
  }

  export function forceSimulation<N extends SimulationNodeDatum>(nodes?: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;
  export function forceLink<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>>(links?: L[]): ForceLink<N, L>;
  export function forceManyBody<N extends SimulationNodeDatum>(): ForceManyBody<N>;
  export function forceCollide<N extends SimulationNodeDatum>(radius?: number | ((node: N, i: number, nodes: N[]) => number)): ForceCollide<N>;
  export function forceCenter<N extends SimulationNodeDatum>(x?: number, y?: number, z?: number): ForceCenter<N>;
  export function forceX<N extends SimulationNodeDatum>(x?: number | ((node: N, i: number, nodes: N[]) => number)): ForceX<N>;
  export function forceY<N extends SimulationNodeDatum>(y?: number | ((node: N, i: number, nodes: N[]) => number)): ForceY<N>;
  export function forceZ<N extends SimulationNodeDatum>(z?: number | ((node: N, i: number, nodes: N[]) => number)): ForceZ<N>;
}

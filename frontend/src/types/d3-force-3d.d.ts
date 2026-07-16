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

  export interface SimulationLinkDatum<NodeDatum = SimulationNodeDatum> {
    source: NodeDatum | string | number;
    target: NodeDatum | string | number;
    index?: number;
  }

  export interface ForceCenter {
    (alpha: number): void;
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
    strength(): number;
    strength(strength: number): this;
  }

  export interface ForceManyBody {
    (alpha: number): void;
    strength(): number;
    strength(strength: number | ((d: any, i: number, data: any[]) => number)): this;
    theta(): number;
    theta(theta: number): this;
    distanceMin(): number;
    distanceMin(distance: number): this;
    distanceMax(): number;
    distanceMax(distance: number): this;
  }

  export interface ForceLink<NodeDatum = any, LinkDatum = any> {
    (alpha: number): void;
    id(): (d: NodeDatum, i?: number, data?: NodeDatum[]) => string | number;
    id(fn: (d: NodeDatum) => string | number): this;
    distance(): number;
    distance(distance: number | ((d: LinkDatum, i?: number, data?: LinkDatum[]) => number)): this;
    strength(): number;
    strength(strength: number | ((d: LinkDatum, i?: number, data?: LinkDatum[]) => number)): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  export interface ForceCollide {
    (alpha: number): void;
    radius(): number;
    radius(radius: number | ((d: any, i: number, data: any[]) => number)): this;
    strength(): number;
    strength(strength: number): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  export interface Simulation<NodeDatum, LinkDatum> {
    restart(): this;
    stop(): this;
    tick(): this;
    on(type: 'tick' | 'end', listener: (event: any) => void): this;
    on(type: string): ((event: any) => void) | undefined;
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
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
    force(name: string): any;
    force(name: string, force: any): this;
    find(x: number, y: number, z?: number, radius?: number): NodeDatum | undefined;
    randomSource(): () => number;
    randomSource(source: () => number): this;
  }

  export function forceCenter(x?: number, y?: number, z?: number): ForceCenter;
  export function forceManyBody(): ForceManyBody;
  export function forceLink<NodeDatum = any, LinkDatum = any>(
    links?: LinkDatum[]
  ): ForceLink<NodeDatum, LinkDatum>;
  export function forceCollide(): ForceCollide;
  export function forceSimulation<NodeDatum = any>(nodes?: NodeDatum[]): Simulation<NodeDatum, any>;
  export function forceX(x?: number | ((d: any) => number)): any;
  export function forceY(y?: number | ((d: any) => number)): any;
  export function forceZ(z?: number | ((d: any) => number)): any;
  export function forceRadial(radius?: number | ((d: any) => number), x?: number, y?: number, z?: number): any;
}

import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

interface NodeData {
  id: string;
  mesh: THREE.Mesh;
  label: string;
  category: string;
  velocity: THREE.Vector3;
  radius: number;
}

interface LinkData {
  line: THREE.Line;
  source: NodeData;
  target: NodeData;
}

const CATEGORIES = [
  { key: 'cognitive', label: '认知增强', color: '#5b7c99' },
  { key: 'knowledge', label: '知识网络', color: '#bd4a2e' },
  { key: 'attention', label: '注意力管理', color: '#7d8f6a' },
  { key: 'embodied', label: '具身认知', color: '#b08a3e' },
  { key: 'social', label: '社会大脑', color: '#d4694a' },
];

const NODE_LABELS = [
  '钤记', '知识图谱', '反脆弱', '认知偏差', '深度工作',
  '注意力预算', '具身智能', '情绪位置', '社会认知', 'AI 助手',
  '记忆宫殿', '思维模型', '概念网络', '笔记沉淀', '灵感胶囊',
  '来源可信度', '验证中心', '实践深度', '统计洞察', '语义搜索',
];

function buildNetwork(): { nodes: NodeData[]; links: { sourceIndex: number; targetIndex: number }[] } {
  const nodes: NodeData[] = NODE_LABELS.map((label, i) => ({
    id: `n-${i}`,
    mesh: new THREE.Mesh(),
    label,
    category: CATEGORIES[i % CATEGORIES.length].key,
    velocity: new THREE.Vector3(),
    radius: Math.random() * 0.22 + 0.18,
  }));

  const links: { sourceIndex: number; targetIndex: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    let count = 0;
    for (let j = i + 1; j < nodes.length && count < 3; j++) {
      if (nodes[i].category === nodes[j].category || Math.random() > 0.75) {
        links.push({ sourceIndex: i, targetIndex: j });
        count++;
      }
    }
  }
  return { nodes, links };
}

function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

export default function WelcomeNetwork3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number; visible: boolean }>({
    text: '', x: 0, y: 0, visible: false,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    if (isMobile) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.018);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    camera.position.z = 36;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const p1 = new THREE.PointLight(0x5b7c99, 1.1, 100);
    p1.position.set(20, 20, 20);
    scene.add(p1);

    const p2 = new THREE.PointLight(0xbd4a2e, 0.7, 100);
    p2.position.set(-20, -10, -10);
    scene.add(p2);

    const { nodes, links } = buildNetwork();
    const group = new THREE.Group();

    const sphereGeo = new THREE.SphereGeometry(1, 24, 24);

    nodes.forEach((node, i) => {
      const category = CATEGORIES[i % CATEGORIES.length];
      const color = category.color;
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.6,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 11 + Math.random() * 10;
      mesh.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      mesh.scale.setScalar(node.radius);
      mesh.userData = { nodeId: node.id, color };
      node.mesh = mesh;
      group.add(mesh);
    });

    const linkLines: LinkData[] = [];
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x5b7c99,
      transparent: true,
      opacity: 0.15,
    });

    links.forEach((link) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        nodes[link.sourceIndex].mesh.position,
        nodes[link.targetIndex].mesh.position,
      ]);
      const line = new THREE.Line(geo, lineMat);
      linkLines.push({
        line,
        source: nodes[link.sourceIndex],
        target: nodes[link.targetIndex],
      });
      group.add(line);
    });

    scene.add(group);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredId: string | null = null;
    let isDragging = false;
    let dragNode: NodeData | null = null;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const onMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      if (isDragging && dragNode) {
        const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
        vector.unproject(camera);
        const dir = vector.sub(camera.position).normalize();
        const distance = (camera.position.z - dragNode.mesh.position.z) / dir.z;
        const pos = camera.position.clone().add(dir.multiplyScalar(distance));
        dragNode.mesh.position.copy(pos);
        dragNode.velocity.set(0, 0, 0);
      }
    };

    const onDown = () => {
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(nodes.map((n) => n.mesh));
      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh;
        const id = mesh.userData.nodeId as string;
        dragNode = nodes.find((n) => n.id === id) || null;
        if (dragNode) {
          isDragging = true;
          document.body.style.cursor = 'grabbing';
        }
      }
    };

    const onUp = () => {
      isDragging = false;
      dragNode = null;
      document.body.style.cursor = 'auto';
    };

    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('mouseup', onUp);
    renderer.domElement.addEventListener('mouseleave', onUp);

    let running = true;
    let rafId = 0;
    let lastFrameTime = 0;
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;

    const animate = () => {
      if (!running) return;
      rafId = requestAnimationFrame(animate);

      const now = performance.now();
      if (now - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = now;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(nodes.map((n) => n.mesh));

      if (intersects.length > 0 && !isDragging) {
        const mesh = intersects[0].object as THREE.Mesh;
        const id = mesh.userData.nodeId as string;
        if (hoveredId !== id) {
          nodes.forEach((n) => {
            n.mesh.scale.setScalar(n.radius);
            (n.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
          });
          hoveredId = id;
          const node = nodes.find((n) => n.id === id);
          if (node) {
            node.mesh.scale.setScalar(node.radius * 1.6);
            (node.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
            setTooltip({
              text: truncate(node.label, 28),
              x: lastMouseX + 12,
              y: lastMouseY - 24,
              visible: true,
            });
          }
          document.body.style.cursor = 'pointer';
        }
      } else if (!isDragging) {
        if (hoveredId) {
          nodes.forEach((n) => {
            n.mesh.scale.setScalar(n.radius);
            (n.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
          });
          hoveredId = null;
          setTooltip((t) => ({ ...t, visible: false }));
          document.body.style.cursor = 'auto';
        }
      }

      const center = new THREE.Vector3();
      nodes.forEach((node) => {
        if (node === dragNode) return;

        const force = new THREE.Vector3();
        force.add(center.clone().sub(node.mesh.position).multiplyScalar(0.012));

        nodes.forEach((other) => {
          if (other === node) return;
          const dir = node.mesh.position.clone().sub(other.mesh.position);
          const distSq = dir.lengthSq();
          if (distSq > 0.1 && distSq < 500) {
            force.add(dir.normalize().multiplyScalar(6 / distSq));
          }
        });

        linkLines.forEach((link) => {
          if (link.source === node) {
            const dir = link.target.mesh.position.clone().sub(node.mesh.position);
            force.add(dir.multiplyScalar(0.015));
          } else if (link.target === node) {
            const dir = link.source.mesh.position.clone().sub(node.mesh.position);
            force.add(dir.multiplyScalar(0.015));
          }
        });

        node.velocity.add(force.multiplyScalar(0.016));
        node.velocity.multiplyScalar(0.96);
        node.mesh.position.add(node.velocity);
      });

      linkLines.forEach((link) => {
        const positions = (link.line.geometry as THREE.BufferGeometry).attributes.position.array as Float32Array;
        positions[0] = link.source.mesh.position.x;
        positions[1] = link.source.mesh.position.y;
        positions[2] = link.source.mesh.position.z;
        positions[3] = link.target.mesh.position.x;
        positions[4] = link.target.mesh.position.y;
        positions[5] = link.target.mesh.position.z;
        (link.line.geometry as THREE.BufferGeometry).attributes.position.needsUpdate = true;
      });

      group.rotation.y += 0.0006;
      group.rotation.x = Math.sin(Date.now() * 0.00004) * 0.025;

      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else {
        running = true;
        rafId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      renderer.domElement.removeEventListener('mousemove', onMove);
      renderer.domElement.removeEventListener('mousedown', onDown);
      renderer.domElement.removeEventListener('mouseup', onUp);
      renderer.domElement.removeEventListener('mouseleave', onUp);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-auto" />
      {tooltip.visible && (
        <div
          className="fixed z-50 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur text-xs text-white border border-white/10 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}

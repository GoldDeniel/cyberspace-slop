import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { vertexShader, fragmentShader } from "../shaders/nodeShaders";

export default function CyberspaceViewport({
  spaceState,
  viewMode,
  showAllLabels,
  onToggleMark,
  onWarpToDir,
}) {
  const mountRef = useRef(null);
  const labelsContainerRef = useRef(null);
  const perspCamRef = useRef(null);
  const orthoCamRef = useRef(null);
  const activeCamRef = useRef(null);
  const controlsRef = useRef(null);
  const nodeGroupRef = useRef(null);
  const beamGroupRef = useRef(null);
  const sharedBoxGeoRef = useRef(null);
  const activeLabelsRef = useRef([]);
  const isWarpingRef = useRef(false);
  const lastSectorRef = useRef("");
  const cameraGoalRef = useRef(new THREE.Vector3(0, 18, 28));
  const targetGoalRef = useRef(new THREE.Vector3(0, 0, 0));
  const sharedTimeRef = useRef({ value: 0 });
  const viewModeRef = useRef(viewMode);
  const hoveredPathRef = useRef(null);
  const showAllLabelsRef = useRef(showAllLabels);
  showAllLabelsRef.current = showAllLabels;

  // Keep latest callbacks in refs so we never recreate the WebGL context
  const markCbRef = useRef(onToggleMark);
  const warpCbRef = useRef(onWarpToDir);
  markCbRef.current = onToggleMark;
  warpCbRef.current = onWarpToDir;

  // Helper to free GPU memory properly
  const clearGroupWithDispose = (group) => {
    if (!group) return;
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj.material) obj.material.dispose();
      // Dispose line geometries, but keep our single shared BoxGeometry
      if (obj.geometry && obj.geometry !== sharedBoxGeoRef.current) {
        obj.geometry.dispose();
      }
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const aspect = window.innerWidth / window.innerHeight;
    const perspCam = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
    perspCam.position.set(0, 20, 32);
    perspCamRef.current = perspCam;

    const frustumSize = 95;
    const orthoCam = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      -1000,
      2000,
    );
    orthoCamRef.current = orthoCam;
    activeCamRef.current = perspCam;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(perspCam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.addEventListener("start", () => {
      isWarpingRef.current = false;
    });
    controlsRef.current = controls;

    sharedBoxGeoRef.current = new THREE.BoxGeometry(1, 1, 1);

    const nodeGroup = new THREE.Group();
    const beamGroup = new THREE.Group();
    scene.add(nodeGroup);
    scene.add(beamGroup);
    nodeGroupRef.current = nodeGroup;
    beamGroupRef.current = beamGroup;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getHitNode = (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, activeCamRef.current);
      const hits = raycaster.intersectObjects(nodeGroup.children);
      return hits.length > 0 ? hits[0].object.userData : null;
    };

    // Ctrl+Click (or Cmd+Click) to Mark — leaves Shift free for camera navigation!
    const onPointerDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        const node = getHitNode(e);
        if (node && markCbRef.current) {
          markCbRef.current(node.path);
        }
      }
    };

    const onDblClick = (e) => {
      const node = getHitNode(e);
      if (
        node &&
        (node.node_type === "dir" || node.node_type === "sub_dir_portal") &&
        warpCbRef.current
      ) {
        warpCbRef.current(`cd "${node.path}"`);
      }
    };

    const onPointerMove = (e) => {
      const node = getHitNode(e);
      hoveredPathRef.current = node ? node.path : null;
      renderer.domElement.style.cursor = node ? "pointer" : "default";
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("dblclick", onDblClick);

    const clock = new THREE.Clock();
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      sharedTimeRef.current.value = clock.getElapsedTime();

      const cam = activeCamRef.current;
      const ctrl = controlsRef.current;

      if (isWarpingRef.current) {
        ctrl.target.lerp(targetGoalRef.current, 0.08);
        cam.position.lerp(cameraGoalRef.current, 0.06);
        if (cam.position.distanceTo(cameraGoalRef.current) < 0.3) {
          isWarpingRef.current = false;
        }
      }
      ctrl.update();

      const halfW = window.innerWidth / 2;
      const halfH = window.innerHeight / 2;
      activeLabelsRef.current.forEach((item) => {
        const isHovered = item.path === hoveredPathRef.current;
        const visible =
          isHovered ||
          showAllLabelsRef.current ||
          item.isMainDir ||
          item.alwaysShow;

        if (!visible) {
          item.el.style.display = "none";
          return;
        }

        const projected = item.pos.clone().project(cam);
        if (projected.z > 1 || projected.z < -1) {
          item.el.style.display = "none";
        } else {
          item.el.style.display = "block";
          item.el.classList.toggle("hovered-label", isHovered);
          item.el.style.left = `${projected.x * halfW + halfW}px`;
          item.el.style.top = `${-projected.y * halfH + halfH}px`;
        }
      });

      renderer.render(scene, cam);
    };
    animate();

    const handleResize = () => {
      const asp = window.innerWidth / window.innerHeight;
      perspCam.aspect = asp;
      perspCam.updateProjectionMatrix();

      orthoCam.left = (-frustumSize * asp) / 2;
      orthoCam.right = (frustumSize * asp) / 2;
      orthoCam.top = frustumSize / 2;
      orthoCam.bottom = -frustumSize / 2;
      orthoCam.updateProjectionMatrix();

      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      clearGroupWithDispose(nodeGroup);
      clearGroupWithDispose(beamGroup);
      if (sharedBoxGeoRef.current) sharedBoxGeoRef.current.dispose();
      renderer.dispose();
      container.innerHTML = "";
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  // Switch between 3D Perspective and 2D Top-Down Tactical Mode
  useEffect(() => {
    viewModeRef.current = viewMode;
    const ctrl = controlsRef.current;
    if (!ctrl) return;

    const target = ctrl.target.clone();
    if (viewMode === "2D") {
      const ortho = orthoCamRef.current;
      ortho.position.set(target.x, target.y + 120, target.z);
      ortho.lookAt(target);
      activeCamRef.current = ortho;
      ctrl.object = ortho;
      ctrl.enableRotate = false;
    } else {
      const persp = perspCamRef.current;
      persp.position.set(target.x, target.y + 20, target.z + 32);
      activeCamRef.current = persp;
      ctrl.object = persp;
      ctrl.enableRotate = true;
    }
    ctrl.update();
  }, [viewMode]);

  // Rebuild space with proper GPU disposal & orthogonal circuit links
  useEffect(() => {
    if (!spaceState || !nodeGroupRef.current) return;

    const nodeGroup = nodeGroupRef.current;
    const beamGroup = beamGroupRef.current;
    const labelContainer = labelsContainerRef.current;

    clearGroupWithDispose(nodeGroup);
    clearGroupWithDispose(beamGroup);
    labelContainer.innerHTML = "";
    activeLabelsRef.current = [];

    const [tx, ty, tz] = spaceState.camera_target;

    if (spaceState.current_path !== lastSectorRef.current) {
      targetGoalRef.current.set(tx, ty, tz);
      if (viewModeRef.current === "2D") {
        cameraGoalRef.current.set(tx, ty + 120, tz);
      } else {
        cameraGoalRef.current.set(tx, ty + 20, tz + 32);
      }
      isWarpingRef.current = true;
      lastSectorRef.current = spaceState.current_path;
    }

    const boxGeo = sharedBoxGeoRef.current;
    const centerVec = new THREE.Vector3(tx, ty, tz);

    // Map directory coordinates so we can draw orthogonal 90-degree traces from parent to child
    const dirPosMap = new Map();
    spaceState.nodes.forEach((n) => {
      if (n.node_type === "dir") {
        const yCoord = viewMode === "2D" ? ty - 0.5 : n.y;
        dirPosMap.set(n.path, new THREE.Vector3(n.x, yCoord, n.z));
      }
    });

    spaceState.nodes.forEach((n) => {
      let typeInt = 0;
      if (n.node_type === "exec") typeInt = 1;
      else if (n.node_type === "dir") typeInt = 2;
      else if (n.node_type === "blackwall") typeInt = 3;
      else if (n.node_type === "sub_dir_portal") typeInt = 4;
      else if (n.node_type === "hidden") typeInt = 5;

      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        uniforms: {
          uTime: sharedTimeRef.current,
          uType: { value: typeInt },
          uSeed: { value: n.seed },
          uDepth: { value: n.depth_rel },
          uMatched: { value: n.matched },
          uVisited: { value: n.visited },
          uMarked: { value: n.marked },
        },
      });

      const mesh = new THREE.Mesh(boxGeo, mat);
      const renderY =
        viewMode === "2D" ? ty + (n.node_type === "dir" ? -0.5 : 0.5) : n.y;
      mesh.position.set(n.x, renderY, n.z);
      mesh.scale.set(n.scale_x, viewMode === "2D" ? 0.5 : n.scale_y, n.scale_z);
      mesh.userData = n;
      nodeGroup.add(mesh);

      // Rectangular 90-degree circuit traces between parent and child directories
      if (n.node_type === "dir" && dirPosMap.has(n.parent_path)) {
        const pVec = dirPosMap.get(n.parent_path);
        const cVec = new THREE.Vector3(n.x, renderY, n.z);
        const mid1 = new THREE.Vector3(cVec.x, pVec.y, pVec.z);
        const mid2 = new THREE.Vector3(cVec.x, pVec.y, cVec.z);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          pVec,
          mid1,
          mid2,
          cVec,
        ]);
        const lineMat = new THREE.LineBasicMaterial({
          color: n.visited ? 0x00ff88 : 0x00aaff,
          transparent: true,
          opacity: 0.35,
        });
        beamGroup.add(new THREE.Line(lineGeo, lineMat));
      }

      // Active scan / search / mark telemetry beams
      if (
        (spaceState.scan_active && n.depth_rel === 0) ||
        n.matched ||
        n.marked
      ) {
        const beamColor = n.marked ? 0xff00ff : n.matched ? 0xffd000 : 0x00ffcc;
        const pts = [centerVec, new THREE.Vector3(n.x, renderY, n.z)];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({
          color: beamColor,
          transparent: true,
          opacity: 0.75,
        });
        beamGroup.add(new THREE.Line(lineGeo, lineMat));
      }

      const isDirectory =
        n.node_type === "dir" || n.node_type === "sub_dir_portal";
      const el = document.createElement("div");
      const classes = ["node-label"];
      if (isDirectory) classes.push("dir-label");
      if (n.node_type === "blackwall") classes.push("blackwall-label");
      if (n.marked) classes.push("marked-label");
      if (n.visited) classes.push("visited-label");
      el.className = classes.join(" ");
      el.style.display = "none";

      const prefix = n.marked ? "★ " : isDirectory ? "📁 " : "";
      el.textContent = `${prefix}${n.name}`;
      labelContainer.appendChild(el);

      activeLabelsRef.current.push({
        el,
        path: n.path,
        isMainDir: n.node_type === "dir",
        alwaysShow: n.marked || n.matched,
        pos: new THREE.Vector3(
          n.x,
          renderY + (viewMode === "2D" ? 1.0 : n.scale_y * 0.5 + 0.8),
          n.z,
        ),
      });
    });
  }, [spaceState, viewMode, showAllLabels]);

  return (
    <div className="viewport-container">
      <div ref={mountRef} />
      <div ref={labelsContainerRef} />
    </div>
  );
}

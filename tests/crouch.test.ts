/**
 * The crouch pose.
 *
 * The reported bug was that crouching "just makes you go down into the floor".
 * It did: the legs were one box each, scaled down on Y, so they telescoped
 * instead of folding and the whole body slid downward with the feet shrinking
 * to meet it. A knee is the difference, and the two things that have to hold
 * once there is one are checked here -- the foot stays on the ground, and the
 * crouched silhouette fits inside the collision capsule.
 */
import {
  legPose, walkingLegPose, LEG_H, THIGH_H, SHIN_H, TORSO_H, HEAD_RISE,
  CROUCH_HIP_Y, CROUCH_LEAN,
} from "../client/src/render/character";
import { CROUCH_HEIGHT, PLAYER_HEIGHT } from "../shared/src/constants";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

/**
 * Forward kinematics, mirroring exactly what Character.update does to the
 * scene graph: rotate the hip by `swing - hipBend`, the knee by `kneeBend`
 * relative to it, and walk down the two segments. A positive rotation about X
 * swings a limb backward, which is why the bends are subtracted.
 */
function ankleOf(hipY: number, swing = 0): { y: number; z: number } {
  const pose = walkingLegPose(hipY, swing);
  const thigh = pose.hip;
  const shin = thigh + pose.knee;
  return {
    y: hipY - Math.cos(thigh) * THIGH_H - Math.cos(shin) * SHIN_H,
    z: -Math.sin(thigh) * THIGH_H - Math.sin(shin) * SHIN_H,
  };
}

console.log("segments still add up to a leg");
{
  check("thigh plus shin is the old leg", Math.abs(THIGH_H + SHIN_H - LEG_H) < 1e-9);
  check("neither segment is degenerate", THIGH_H > 0.1 && SHIN_H > 0.1);
}

console.log("standing");
{
  const { hipBend, kneeBend } = legPose(LEG_H);
  check("the hip is square", Math.abs(hipBend) < 0.01, `${hipBend}`);
  check("the knee is straight", Math.abs(kneeBend) < 0.01, `${kneeBend}`);
  const foot = ankleOf(LEG_H);
  check("and the foot is on the ground", Math.abs(foot.y) < 1e-6, `y=${foot.y}`);
}

console.log("crouching folds the leg rather than shrinking it");
{
  const { hipBend, kneeBend } = legPose(CROUCH_HIP_Y);
  check("the hip opens", hipBend > 0.6, `${hipBend.toFixed(2)} rad`);
  check("the knee actually bends", kneeBend > 1.2, `${kneeBend.toFixed(2)} rad`);

  const foot = ankleOf(CROUCH_HIP_Y);
  check("the foot is still on the ground", Math.abs(foot.y) < 1e-6, `y=${foot.y}`);
  // A knee that folds forward is the whole visual difference between crouching
  // and sinking. If this ever goes to zero the pose is telescoping again.
  const knee = {
    y: CROUCH_HIP_Y - Math.cos(-hipBend) * THIGH_H,
    z: -Math.sin(-hipBend) * THIGH_H,
  };
  check("and the knee comes forward", knee.z > 0.2, `z=${knee.z.toFixed(2)}`);
}

console.log("the foot never goes through the floor");
{
  // Every stance between standing and fully crouched, and every point of the
  // walk cycle at each -- this is the assertion the bug report was about.
  let worst = 0, worstAt = "";
  for (let c = 0; c <= 1.0001; c += 0.02) {
    const hipY = LEG_H + (CROUCH_HIP_Y - LEG_H) * c;
    for (let swing = -0.85; swing <= 0.85; swing += 0.05) {
      const foot = ankleOf(hipY, swing);
      if (foot.y < worst) { worst = foot.y; worstAt = `crouch ${c.toFixed(2)} swing ${swing.toFixed(2)}`; }
    }
  }
  // A swinging leg lifts off the ground, which is correct; what must never
  // happen is a foot BELOW it.
  check("no pose puts a foot underground", worst > -1e-6, `${worst.toFixed(4)}m at ${worstAt}`);
}

console.log("the silhouette fits the hitbox");
{
  // A model taller than its capsule shows a head that cannot be shot.
  const standTop = LEG_H + TORSO_H + HEAD_RISE;
  check("standing matches the player height", Math.abs(standTop - PLAYER_HEIGHT) < 0.05,
    `${standTop.toFixed(2)} vs ${PLAYER_HEIGHT}`);

  const crouchTop = CROUCH_HIP_Y + Math.cos(CROUCH_LEAN) * TORSO_H + HEAD_RISE;
  check("crouched fits inside the crouched capsule", crouchTop <= CROUCH_HEIGHT + 0.02,
    `${crouchTop.toFixed(2)} vs ${CROUCH_HEIGHT}`);
  // ...but is not so short that the model sinks into its own boots.
  check("and is not absurdly short", crouchTop > CROUCH_HEIGHT - 0.25,
    `${crouchTop.toFixed(2)} vs ${CROUCH_HEIGHT}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

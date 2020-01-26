const esRaw = require('./lib');


function run(codeObj, challengeIndex, cb) {
  const worldController = esRaw.createWorldController(1.0 / 60.0);
  const worldCreator    = esRaw.createWorldCreator();
  const challenge       = esRaw.challenges[challengeIndex];
  const world           = worldCreator.createWorld(challenge.options);

  world.on('stats_changed', () => {
    const stats = challenge.condition.evaluate(world);
    if (stats !== null && !worldController.isPaused && !world.challengeEnded) {
      world.challegeEnded = true;
      worldController.setPaused(true);
      cb(
        stats,
        {
          transportedCounter: world.transportedCounter,
          transportedPerSec: world.transportedPerSec,
          moveCount: world.moveCount,
          elapsedTime: world.elapsedTime,
          maxWaitTime: world.maxWaitTime,
          avgWaitTime: world.avgWaitTime,
        }
      );
    }
  });

  var t = 0.0;
  worldController.setTimeScale(1000.0);
  worldController.start(
    world,
    codeObj,
    (updater) => {
      if (!worldController.isPaused) {
        setTimeout(() => updater(t++), 0);
      }
    },
    true
  );

  return worldController;
}

module.exports = { run };

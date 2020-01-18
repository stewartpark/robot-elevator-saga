const es = require('.');

es.run(
  {
    init: (elevators, floors) => {
      var elevator = elevators[0]; // Let's use the first elevator
      // Whenever the elevator is idle (has no more queued destinations) ...
      elevator.on("idle", function() {
        // let's go to all the floors (or did we forget one?)
        elevator.goToFloor(0);
        elevator.goToFloor(1);
        elevator.goToFloor(2);
      });
    },
    update: () => {}
  },
  0,
  (passed, world) => {
    console.log(passed, world);
  }
);

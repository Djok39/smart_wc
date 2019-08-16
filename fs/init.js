load('api_config.js');
load('api_net.js');
load('api_dash.js');
load('api_events.js');
// load('api_gcp.js');
load('api_gpio.js');
load('api_mqtt.js');
load('api_shadow.js');
load('api_timer.js');
load('api_sys.js');
// load('api_watson.js');
load('api_mq.js');
load('api_z19.js');
load('api_led.js');

let base = Event.baseNumber("SM_");
if (!Event.regBase(base, "Smart node")) {
  die("Failed to register base event number");
}

let METHANE = base + 1;
let CO = base + 2;
let CO2 = base + 3;

let led = Cfg.get('board.led1.pin'); // Built-in LED GPIO number
let enabled = 0;    // We using open drain output, so high is 0
let online = false; // Connected to the cloud?

// init lights
let initLight = function(pin) {
  GPIO.write(pin, !enabled);
  GPIO.set_mode(pin, 2);
  GPIO.set_pull(pin, GPIO.PULL_NONE);
};

initLight(Cfg.get('load1'));
initLight(Cfg.get('load2'));
initLight(Cfg.get('load3'));
initLight(Cfg.get('load4'));
initLight(Cfg.get('load5'));

initLight(Cfg.get('led.alert1'));
initLight(Cfg.get('led.alert2'));
// initLight(Cfg.get('led.alert3'));

initLight(Cfg.get('led.lock1'));
initLight(Cfg.get('led.lock2'));

GPIO.set_mode(led, 1);

let light_proto = {motion: null, lamp: 0, door: -1, door_state: 1, motion_state: 0, timer: null, led_locked: null, locked: false, enabled_at: -1.0, disabled_at: -1.0, forced_at: -7.0}; 
let timeout_base = Cfg.get('light.timeout');
let pir_slippage_time = 7.0; // HC-SR501 sensor has bug/feature, where you leave room, but sensor will still detect motion for some time.
let alarm_led = Cfg.get('led.alert1'); // show exceptions while experimenting
let smart_socket_pin = Cfg.get('load5');
// Свет в корридоре
let passage = Object.create(light_proto);
passage.id = "passage";
passage.lamp = Cfg.get('load1');
passage.motion = Cfg.get('motion3');

// Свет в туалете
let toilet = Object.create(light_proto);
toilet.id = "toilet";
toilet.lamp = Cfg.get('load2');
toilet.motion = Cfg.get('motion2');
toilet.door = Cfg.get('door2');
toilet.led_locked = Cfg.get('led.lock2');

// Свет в ванной
let bathroom = Object.create(light_proto);
bathroom.id = "bathroom";
bathroom.lamp = Cfg.get('load3');
bathroom.motion = Cfg.get('motion1');
bathroom.door = Cfg.get('door1');
bathroom.led_locked = Cfg.get('led.lock1');

// MQ9 sensor handling
let warming_up = true;
let methane = 0;
let co = 0;
// ventilation control values
let co2 = 0;
let fan_state = 0;
let fan_pin = Cfg.get('load4');

let fan_set = function(new_state){
  if (fan_state === new_state || !fan_pin){
    return;
  };

  fan_state = new_state;
  GPIO.write(fan_pin, !fan_state); // we have inverted output (open drain)
  MQTT.pub('fan1', JSON.stringify(fan_state), 0);
};

let hysteresis = 150;
let fan_logic = function(){
  if (!fan_pin)
    return;

  let human_in_toilet = toilet.timer || toilet.locked;
  let human_in_bathroom = bathroom.timer || bathroom.locked;

  let ctrl = fan_state ? (co2+hysteresis) : co2;

  if (ctrl > 1400.0){
    fan_set(1);
  }else if ((ctrl >= 700.0 || co >= 500.0) && !human_in_toilet && !human_in_bathroom){
    fan_set(1);
  //}else if (ctrl >= 900.0 && !human_in_toilet){
  //  fan_set(1);
  }else{
    fan_set(0);
  };
};

// red-green led with common anode
// we use that to indicate CO2 level, where red - very bad, and green - very good level.
let bicolor_led_red = 12;
let bicolor_led_green = 17;
GPIO.set_mode(bicolor_led_red, GPIO.MODE_OUTPUT);
GPIO.set_pull(bicolor_led_red, GPIO.PULL_NONE);
GPIO.write(bicolor_led_red, 0);
GPIO.set_mode(bicolor_led_green, GPIO.MODE_OUTPUT);
GPIO.set_pull(bicolor_led_green, GPIO.PULL_NONE);
GPIO.write(bicolor_led_green, 0);

let bicolor_led_logic = function(){
  GPIO.write(bicolor_led_red, (co2 > 600));
  GPIO.write(bicolor_led_green, (co2 < 1000));
};

// simple red or yellow led to show VOC level (MQ9 sensor). raw value range is 0..1000.0
let mq_led = Cfg.get('led.alert2');
let mq_status_led_logic = function(){
  if (!mq_led)
    return;

  if (co < 100.0 && methane < 200.0){
    LED.set(mq_led, LED.OFF);
  }else if (co > 800.0 || methane > 800.0){
    LED.set(mq_led, LED.FAST);
  }else if (co > 500.0){
    LED.set(mq_led, LED.ON);
  }else if (co > 200.0 || methane > 300.0){
    LED.set(mq_led, LED.BLINK);
  }else{
    LED.set(mq_led, LED.RARE);
  };
};

if (Cfg.get('mq.enable') && MQ.init()){
  Event.on(METHANE, function() {
    if (warming_up){
      if (MQ.value() < 0){
        return;
      }
      warming_up = false;
      print("MQ sensor ready.");
    }else{
      methane = MQ.value();
      fan_logic();
      mq_status_led_logic();

      if (!Cfg.get('mqtt.enable')){
        return;
      }

      GPIO.toggle(led);
      MQTT.pub('methane/' + Cfg.get('node.name'), JSON.stringify(methane), 0);
      print('Published', MQ.designation(), 'with', methane);
      GPIO.toggle(led);
    };
  }, null);

  Event.on(CO, function() {
    if (warming_up){
      print("unexpected behavior");
    }else{
      co = MQ.value();
      fan_logic();
      mq_status_led_logic();

      if (!Cfg.get('mqtt.enable')){
        return;
      }

      GPIO.toggle(led);
      MQTT.pub('co/' + Cfg.get('node.name'), JSON.stringify(co), 0);
      print('Published', MQ.designation(), 'with', co);
      GPIO.toggle(led);
    };
  }, null);
}

if (Cfg.get('z19.enable') && Z19.init()){
  Event.on(CO2, function() {
    GPIO.toggle(led);
    co2 = Z19.value();
    MQTT.pub('co2/' + Cfg.get('node.name'), JSON.stringify(co2), 0);
    print('Published CO2:', co2);
    GPIO.toggle(led);
    bicolor_led_logic();
    fan_logic();
  }, null);
}

// Online status led
let ledOnline = Cfg.get('led.online');
if (ledOnline){
  initLight(ledOnline);

  Event.on(Net.STATUS_CONNECTING, function() {
    LED.set(ledOnline, LED.FAST);
  }, null);

  Event.on(Net.STATUS_DISCONNECTED, function() {
    LED.set(ledOnline, LED.OFF);
  }, null);

  Event.on(Net.STATUS_GOT_IP, function() {
    LED.set(ledOnline, LED.RARE);
  }, null);

  Event.on(Event.CLOUD_CONNECTED, function() {
    online = true;
    LED.set(ledOnline, LED.ON);
  }, null);

  Event.on(Event.CLOUD_DISCONNECTED, function() {
    LED.set(ledOnline, LED.RARE);
    online = false;
  }, null);
};

let isDoorClosed = function(self) {
  return (!self.door_state);
};

let isDoorOpen = function(self) {
  return !isDoorClosed(self);
};

let lock = function(self) {
  if (self.timer) {
    Timer.del(self.timer);
    self.timer = null;
  };
  self.locked = true;
  if (self.led_locked){
    LED.set(self.led_locked, LED.ON);
  }
  print("light locked at", self.id);
};

let unlock = function(self) {
  self.locked = false;
  if (self.led_locked){
    LED.set(self.led_locked, LED.OFF);
  };
  // set light auto off timer, if light is enabled now
  /*
  print("light unlock at", self.id);
  if (self.enabled_at > self.disabled_at){
    switch_on(self, timeout_base);
  };*/
};

let switch_on = function(self, timeout) {
  if (self.timer){
    print("lamp", self.lamp, "timer reset", timeout, "sec");
    Timer.del(self.timer);
  }else{
    self.enabled_at = Sys.uptime();
    print("lamp", self.lamp, "timer set", timeout, "sec");
  }

  GPIO.write(self.lamp, enabled);

  self.timer = Timer.set(timeout*1000, 0, function(self) {
    GPIO.write(self.lamp, !enabled);
    self.timer = null;
    self.locked = false;
    if (self.led_locked){
      LED.set(self.led_locked, LED.OFF);
    }
    self.disabled_at = Sys.uptime();
    print("lamp", self.lamp, "off by timeout");
    MQTT.pub('light/' + self.id, '0', 0);
    fan_logic();
  }, self);
  // timer running -> led blinking
  if (self.led_locked){
    LED.set(self.led_locked, timeout <= timeout_base ? LED.FAST : LED.BLINK);
  }
  MQTT.pub('light/' + self.id, '1', 0);
  MQTT.pub('timeout/' + self.id, JSON.stringify(timeout), 0);
  fan_logic();
};

let switch_off = function(self) {
  // check for light enabled, before switching off
  if (self.timer) {
    print("lamp", self.lamp, "forced off");
    Timer.del(self.timer);
    self.timer = null;
  }
  GPIO.write(self.lamp, !enabled);
  if (self.locked){
    unlock(self);
  };
  self.forced_at = Sys.uptime();
  MQTT.pub('light/' + self.id, '0', 0);
  fan_logic();
};

GPIO.set_mode(passage.motion, GPIO.MODE_INPUT);
GPIO.set_pull(passage.motion, GPIO.PULL_DOWN);
GPIO.set_int_handler(passage.motion, GPIO.INT_EDGE_ANY, function(pin, room) {
  // GPIO.disable_int(pin);
  let current_state = GPIO.read(pin);
  /*
  if (passage.motion_state === current_state){
    // nothing new
    return;
  }*/
  passage.motion_state = current_state;
  if (current_state){
    let forced_age = Sys.uptime() - passage.forced_at;
    if (forced_age >= pir_slippage_time){
      switch_on(passage, passage.timer ? (timeout_base * 3) : timeout_base);
      // check neighboring rooms with locked light
      if (isDoorOpen(toilet) && toilet.locked){
        unlock(toilet);
        let open_age = Sys.uptime() - toilet.open_at;
        if (open_age <= 3.0){
          switch_off(toilet);
          // Since the person was needed a toilet.
          // so reduce the light timeout in the passage to ~7 seconds and prohibit switching on for a while.
          switch_on(passage, pir_slippage_time);
          passage.forced_at = Sys.uptime();
        }else{
          switch_on(toilet, timeout_base);
        }
      }
      if (isDoorOpen(bathroom) && bathroom.locked){
        unlock(bathroom);
        let open_age = Sys.uptime() - bathroom.open_at;
        if (open_age <= 2.0){
          switch_off(bathroom);
          // Since the person was needed a bathroom.
          // so reduce the light timeout in the passage to ~7 seconds and prohibit switching on for a while.
          switch_on(passage, pir_slippage_time);
          passage.forced_at = Sys.uptime();
        }else{
          switch_on(bathroom, timeout_base);
        }
      }
      // Welcome light on
      if (isDoorOpen(bathroom) && !bathroom.locked && !bathroom.timer){
        let passage_light_age = Sys.uptime() - passage.enabled_at;
        let passage_time_since_disable = Sys.uptime() - passage.disabled_at;
        if (passage_light_age < 0.5 && passage_time_since_disable > 30.0){
          switch_on(bathroom, 2.0);
        }
      }
    }
  }
  MQTT.pub('motion/' + passage.id, JSON.stringify(current_state), 0);
  //GPIO.enable_int(pin);
}, passage);
GPIO.enable_int(passage.motion);

let setup_room_motion_handler = function(room){
  GPIO.set_mode(room.motion, GPIO.MODE_INPUT);
  GPIO.set_pull(room.motion, GPIO.PULL_DOWN);
  GPIO.set_int_handler(room.motion, GPIO.INT_EDGE_ANY, function(pin, room) {
    if (room.locked){
      // motion in locked room, where light always on. So ignoring.
      // print("ignoring motion in locked state", room.id);
      return;
    }
    let current_state = GPIO.read(room.motion);
    /*if (room.motion_state === current_state){
      // nothing new
      return;
    }*/
    room.motion_state = current_state;
    // GPIO.disable_int(room.motion);
    // print("motion in", room.id ,"is", state);
    if (room.motion_state/* && !room.locked */){
      let forced_age = Sys.uptime() - room.forced_at;
      // ignore motions after forced event.
      if (forced_age >= pir_slippage_time){
        switch_on(room, room.timer ? (timeout_base * 3) : timeout_base);
        let room_light_age = Sys.uptime() - room.enabled_at;
        let passage_pass_time = Sys.uptime() - passage.enabled_at;
        if (isDoorOpen(room) && passage.timer && room.timer && room_light_age < 2.0){
          // person exactly moving to this room, he won't need light at passage anymore
          if (passage_pass_time < 3.0){
            switch_off(passage);
          }
        }
        // case 1 to lock light alaways on
        if (isDoorClosed(room)){
          let door_closed_age = Sys.uptime() - room.closed_at;
          if (door_closed_age >= pir_slippage_time){
            print("lock case 1");
            lock(room);
          }
        }else{
          /*
          // case 2 to lock light alaways on
          if (!passage.timer && passage_pass_time > pir_slippage_time){
            print("lock case 2");
            lock(room);
          }*/
        }
      }
    }
    MQTT.pub('motion/' + room.id, JSON.stringify(room.motion_state), 0);
    // GPIO.enable_int(room.motion);
  }, room);
  GPIO.enable_int(room.motion);
};

setup_room_motion_handler(toilet);
setup_room_motion_handler(bathroom);

// Door events handler
let setup_door_handler = function(room){
  GPIO.set_mode(room.door, GPIO.MODE_INPUT);
  GPIO.set_pull(room.door, GPIO.PULL_UP);
  // set object current state
  let current_state = GPIO.read(room.door); 
  room.door_state = current_state;
  room.open_at = 0.0;
  room.closed_at = 0.0;

  GPIO.set_int_handler(room.door, GPIO.INT_EDGE_ANY, function(pin, room) {
    // GPIO.disable_int(pin); // mjs so slow, can loss interrupts while enable/disable them
    if (room.door_debouncer){
      return;
    }
    // debounce
    room.door_debouncer = Timer.set(50, 0, function(self){
      print("door pin triggered", self.door);
      let newState = GPIO.read(self.door);
      if (self.door_state !== newState){
        self.door_state = newState;
        // On door open...
        if (self.door_state){
          self.open_at = Sys.uptime();
          let room_light_on = self.timer || self.locked;
          if (!room_light_on && passage.timer){
            switch_on(self, pir_slippage_time);
            // make sure, that human going exactly to this room
            let passage_pass_time = Sys.uptime() - passage.enabled_at;
            if (passage_pass_time < 4.0){ // lower timeout for passage
              switch_on(passage, pir_slippage_time);
              passage.forced_at = Sys.uptime();
            }
          }else if (room_light_on && !passage.timer){
            switch_on(passage, timeout_base / 2.0);
            // passage.forced_at = Sys.uptime();
          }else if (!room_light_on && !passage.timer){
            // Bad situation.
            // Свет не горит вообще нигде, но дверь была открыта, вероятно, ветром. по сути, исключительная ситуация.
            // Но так же это могут быть ошибки в коде. Чтобы обрабатывать подобные ошибки в конечном продукте, следует добавить действие по умолчанию.
            // Я пока оставлю так для отладки
            // TODO: may be remove forced_at time in both neighboring rooms. (?)
            if (alarm_led){
              LED.set( alarm_led, LED.FAST);
            }
            // LED.set( Cfg.get('led.alert3'), LED.FAST);
          };
          MQTT.pub('door/' + self.id, '1', 0);
        // On door close...
        }else{
          // Включать свет - это одно, а вот выключая, можно оставить человека в темноте, неожиданно для него, поэтому, процесс выключения должен быть более умным
          self.closed_at = Sys.uptime();
          // Можно выключить свет, если он горит в обоих помещениях, но в одном помещении он зажёгся только что (не более 3 секунд назад, а во втором он горел гораздо дольше, в 3 раза дольше)
          if (self.timer && passage.timer){
            let room_light_age = Sys.uptime() - self.enabled_at;
            let passage_light_age = Sys.uptime() - passage.enabled_at;
            if (room_light_age <= 3.0 && room_light_age*2.0 < passage_light_age){
              // user went to room from passage
              // Здесь я ожидаю ложные срабатывания. нужно соблюдать бдительность.
              switch_off(passage);
            }else if (passage_light_age <= 3.0 && passage_light_age*4.0 < room_light_age){
              // user went to passage from room
              // Здесь ложные срабатывания почти не возможны, в любом случае, человек будет достаточно долго находиться в комнате, прежде чем выйдет.
              switch_off(self);
            }
          }
          MQTT.pub('door/' + self.id, '0', 0);
        }
      }
      self.door_debouncer = null;
      // GPIO.enable_int(self.door);
    }, room);
  }, room);
  GPIO.enable_int(room.door);
  MQTT.pub('door/' + room.id, JSON.stringify(current_state), 0);
};

setup_door_handler(bathroom);
setup_door_handler(toilet);

let socket_timer = null;
// Boot button -> toggles smart socket state with off timer, there is external PULL UP resistor (?).
GPIO.set_button_handler(0, GPIO.PULL_NONE, GPIO.INT_EDGE_NEG, 50, function() {
  let state = GPIO.toggle(Cfg.get('load5')) ? '0' : '1'; // toggle smart socket
  MQTT.pub('socket1', state, 0);
  // auto off timer 20 minuts
  if (socket_timer) {
    Timer.del(socket_timer);
    socket_timer = null;
  };
  socket_timer = Timer.set(20*60000, 0, function(self) {
    GPIO.write(Cfg.get('load5'), !enabled);
    print("socket1 off by timeout");
    MQTT.pub('socket1', '0', 0);
    socket_timer = null;
  }, null);
}, null);
// public initial state
MQTT.pub('socket1', '0', 0);
MQTT.pub('fan1', '0', 0);

MQTT.setEventHandler(function(conn,ev,evdata){
  if( ev === MQTT.EV_CONNACK ){
    if (smart_socket_pin){
      MQTT.sub('socket1/set', function(conn, topic, msg) {
        let value = JSON.parse(msg);
        GPIO.write(smart_socket_pin, !value); // we have inverted output (open drain)
        MQTT.pub('socket1', msg, 0);
      }, null);  
    };
    
    if (fan_pin){
      MQTT.sub('fan1/set', function(conn, topic, msg) {
        fan_set(JSON.parse(msg));
      }, null);
    };

    if (alarm_led){
      MQTT.sub('alarm/set', function(conn, topic, msg) {
        let value = JSON.parse(msg);
        GPIO.write(alarm_led, !value); // we have inverted output (open drain)
        MQTT.pub('alarm', msg, 0);
      }, null);
    };
  };
},null);
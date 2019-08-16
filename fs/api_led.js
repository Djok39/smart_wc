load('api_gpio.js');

let LED = {
  set: ffi('bool led_set(int,int)')
};

LED.OFF = 0;
LED.ON = 1;
LED.RARE = 2;
LED.BLINK = 3;
LED.FAST = 4;

// status led driver.
// Authors: Djok_39
// License: MIT
#include "mgos.h"

#define LED_OFF 0
#define LED_ON 1
#define LED_RARE 2
#define LED_BLINK 3
#define LED_FAST 4

static int8_t led_state[34] = {-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1};

static void blink_timer_cb(void *arg) {
  int pin = (int)arg;
  bool current = mgos_gpio_read_out(pin);
  int mode = led_state[pin];
  if (mode == LED_OFF && current != 1){
    mgos_gpio_write(pin, 1);  // off
  }else if (mode == LED_ON && current != 0){
    mgos_gpio_write(pin, 0);  // off
  }else if (mode == LED_FAST){
    if (mgos_gpio_toggle(pin)){
      mgos_set_timer(80, 0, blink_timer_cb, (void*)pin);
    }else{
      mgos_set_timer(20, 0, blink_timer_cb, (void*)pin);
    }
  }else if (mode == LED_RARE){
    if (mgos_gpio_toggle(pin)){
      mgos_set_timer(1980, 0, blink_timer_cb, (void*)pin);
    }else{
      mgos_set_timer(20, 0, blink_timer_cb, (void*)pin);
    }
  }else if (mode == LED_BLINK){
    if (mgos_gpio_toggle(pin)){
      mgos_set_timer(500, 0, blink_timer_cb, (void*)pin);
    }else{
      mgos_set_timer(500, 0, blink_timer_cb, (void*)pin);
    }
  }
}

bool led_set(int pin, int state){
  if (pin>=0 && pin<=33){
    int oldState = led_state[pin];
    if (oldState<0){
      // init first
      mgos_gpio_set_mode(pin, MGOS_GPIO_MODE_OUTPUT_OD);
      mgos_gpio_write(pin, 1);  // off
    }
    led_state[pin] = state;

    if (state == LED_OFF){
      mgos_gpio_write(pin, 1);  // off
      return true;
    }

    if (oldState <= 1){
      mgos_gpio_write(pin, 0);  // on
      if (state == LED_FAST){
        mgos_set_timer(30, 0, blink_timer_cb, (void*)pin);
      }else if (state == LED_BLINK){
        mgos_set_timer(500, 0, blink_timer_cb, (void*)pin);
      }else if (state == LED_RARE){
        mgos_set_timer(20, 0, blink_timer_cb, (void*)pin);
      }
    }

    return true;
  }else{
    return false;
  }
};

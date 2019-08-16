load('api_events.js');

let Z19 = {
  init: ffi('bool z19_init(void)'),
  value: ffi('int z19_get_valid_ppm(void)'),
  t: ffi('int z19_get_temperature(void)')
};

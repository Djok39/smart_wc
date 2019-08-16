load('api_events.js');

let MQ = {
  init: ffi('bool mq_init(void)'),
  value: ffi('double mq_read_value(void)'),
  designation: ffi('char* mq_read_designation(void)')
};

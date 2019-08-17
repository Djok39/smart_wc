// z19b UART driver, tested with ESP32. 
// Authors: Djok_39
// License: MIT
#include "mgos.h"

#define UART_NO 1
// #define Z19_MA_BUFFER 5  // moving average smoothing
#define EVENT_GRP_SM MGOS_EVENT_BASE('S', 'M', '_')
#define SM_CO2_AVAILABLE (EVENT_GRP_SM + 3)

struct Z19_STATE{
  bool      initialised;
  time_t    timestamp;
  // uint16_t  ppm;
  int       ppm;
#ifdef Z19_MA_BUFFER
  uint16_t  buffer[Z19_MA_BUFFER];
  int       top;  // index in buffer on last measurement
#endif
  uint8_t   temperature;
  uint8_t   undocumented;
  char* specialState;
};

static struct Z19_STATE z19;
static const uint8_t cmd_abc_on[] = {0xFF,0x01,0x79,0xA0,0x00,0x00,0x00,0x00,0xE6};
static const uint8_t cmd_abc_off[] = {0xFF,0x01,0x79,0x00,0x00,0x00,0x00,0x00,0xE6};
static const uint8_t cmd_read[]    = {0xFF,0x01,0x86,0x00,0x00,0x00,0x00,0x00,0x79};

static uint8_t calculateChecksum(uint8_t *array)
{
  uint8_t checksum = 0;
  for (uint8_t i = 1; i < 8; i++) checksum += array[i];
  checksum = 0xFF - checksum;
  return (checksum+1);
}

static void uart_dispatcher(int uart_no, void *arg) {
  size_t rx_av;
  size_t cntUart;
  uint8_t response[9];
  assert(uart_no == UART_NO);
  assert(z19.initialised);
  while ((rx_av = mgos_uart_read_avail(uart_no)) >= 9)
  {
    // read first byte
    cntUart=mgos_uart_read(uart_no, &response, 1);
    if (response[0] != 0xFF){
      LOG(LL_WARN, ("z19 bad signature byte via UART%d, avail %d", UART_NO, mgos_uart_read_avail(uart_no)));
      continue;
    }
    // read next 8 bytes
    cntUart = mgos_uart_read(uart_no, &response[1], 8);
    assert(cntUart == 8);
    uint8_t sum = calculateChecksum((uint8_t*)&response);
    if (response[8] != sum){
      LOG(LL_WARN, ("z19 response bad checksum."));
      continue;
    }
    if (response[1] != 0x86){
      LOG(LL_WARN, ("z19 response is not a ppm."));
      continue;
    }
    z19.temperature = response[4] - 40;
    z19.undocumented = response[6];
    uint8_t ss = response[5];
    /*uint16_t uu = response[6];
    uu <<= 8;
    uu += response[7];*/
    z19.ppm = response[2];
    z19.ppm <<= 8;
    z19.ppm += response[3];

  #ifdef Z19_MA_BUFFER
    z19.top++;
    if (z19.top >= Z19_MA_BUFFER)
      z19.top=0;

    z19.buffer[z19.top] = z19.ppm;
  #endif
    // if (time_initialised)
    time(&z19.timestamp);
    
    LOG(LL_DEBUG, ("z19 ppm=%d t=%d ss=%d u1=%d u2=%d", z19.ppm, z19.temperature, ss, response[6], response[7]));
    // wurmup period ends
    if (z19.specialState && (mgos_uptime() > 180.0 || z19.undocumented)){
      z19.specialState = NULL;
    }
    // send event to upper level.
    if (!z19.specialState){
      mgos_event_trigger(SM_CO2_AVAILABLE, (void*)&z19);
    }
  }
  (void) arg;
}

void z19_set_abc(bool enabled)
{
  mgos_uart_write(UART_NO, enabled? &cmd_abc_on : &cmd_abc_off, 9);
}

static void timer_cb(void *arg) {
  mgos_uart_write(UART_NO, &cmd_read, 9);
  (void) arg;
}

static void timer_start_another_timer_cb(void *arg) {
  // timer_cb(NULL); // first run
  mgos_set_timer(5000 /* ms */, MGOS_TIMER_RUN_NOW | MGOS_TIMER_REPEAT, timer_cb, NULL /* arg */);
  LOG(LL_INFO, ("z19 timer starts"));
  (void) arg;
}

int z19_get_temperature(void){
  if (!z19.initialised || !z19.timestamp)
    return 0;

  return z19.temperature;  
}

// return ppm or NULL, which means "no value"
int z19_get_valid_ppm(void){
  if (!z19.initialised || !z19.timestamp || z19.specialState)
    return NULL;

#ifdef Z19_MA_BUFFER
  int currentPpm = z19.buffer[z19.top];
#else
  int currentPpm = z19.ppm;  
#endif
  // filter inadequate values
  if (currentPpm<250 /* || z19.ppm>=5000*/)
    return NULL;

#ifdef Z19_MA_BUFFER
  double sum = 0.0;
  int i=0;
  for(; i < Z19_MA_BUFFER; i++ ){
    int val = z19.buffer[i];
    if (val == 0)
      break;
    else
      sum += val;
  };
  return i ? (int)(sum / (double)i) : 0;
#else
  return currentPpm;  
#endif
}

bool z19_init(int uartRx, int uartTx){
  if (z19.initialised)
    return true;

  struct mgos_uart_config ucfg;
  mgos_uart_config_set_defaults(UART_NO, &ucfg);
  ucfg.dev.rx_gpio = uartRx;
  ucfg.dev.tx_gpio = uartTx;
  ucfg.baud_rate = 9600;
  ucfg.num_data_bits = 8;
  ucfg.parity = MGOS_UART_PARITY_NONE;
  ucfg.stop_bits = MGOS_UART_STOP_BITS_1;
  if (!mgos_uart_configure(UART_NO, &ucfg)) {
    return false;
  }

  z19.ppm=0;
#ifdef Z19_MA_BUFFER
    z19.top=0;
    for(int i=0; i < Z19_MA_BUFFER; i++ )
      z19.buffer[i] = 0;
#endif

  z19.initialised = true;
  z19.specialState = "Warmup";

  mgos_uart_set_dispatcher(UART_NO, uart_dispatcher, NULL /* arg */);
  mgos_uart_set_rx_enabled(UART_NO, true);
  // start main timer with latency, to obtain more "online" reading
  mgos_set_timer(1200, false /* repeat */, timer_start_another_timer_cb, NULL /* arg */);
  z19_set_abc(false);
  return true;
};

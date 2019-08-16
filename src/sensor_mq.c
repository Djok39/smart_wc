// MQ* gas sensor driver. Suitable for MQ7, MQ9 and other MQ*
// Authors: Djok_39
// License: MIT
#include "mgos.h"
#include "mgos_adc.h"
#include "driver/adc.h"
#include "math.h"

#define EVENT_GRP_SM MGOS_EVENT_BASE('S', 'M', '_')
#define SM_METHANE_AVAILABLE (EVENT_GRP_SM + 1)
#define SM_CO_AVAILABLE (EVENT_GRP_SM + 2)
#define PM_MQ9_SAMPLES 64
#define HW_TICK_USEC 500
#define MEASURE_TICK_MS (20)
#define LOW_DUTY_TICKS (90000000 / HW_TICK_USEC)
#define HIGH_DUTY_TICKS (60000000 / HW_TICK_USEC)
#define K (MEASURE_TICK_MS*1000 / HW_TICK_USEC)
#define MEASURE_TICKS_WINDOW (K*PM_MQ9_SAMPLES + K*10) // samples*1_tick + 100msec
#define LOW_BEGIN_MEASURE_TICK (LOW_DUTY_TICKS - MEASURE_TICKS_WINDOW)
#define HIGH_BEGIN_MEASURE_TICK (HIGH_DUTY_TICKS - MEASURE_TICKS_WINDOW)
#define ADC2VALUE (1000.0/4095.0) // i want to see range from 0...1000 on display, but instead 1000.0 i want to see something like "OVR" as overshoot indication

struct PM_MQ9_STATE{
  bool      initialised;
  double    methane;
  double    co;
  bool      methane_valid;  // deprecated
  bool      co_valid;       // deprecated
};

struct PM_MQ9_STATE pm_mq9;

static int measureTimerId = 0;
static int timerTick = 0;
static bool doMeasure = false;
static bool dualMode = true;  // Measure CO and Methane as described in datasheet
static int samplesTop = 0;
static uint16_t samples[PM_MQ9_SAMPLES];
static double previousValue = -1000.0; // mark as ivalid
static char* previousName = "";
static int power = 0;
static int sense = 0;

struct PWM_Mode{
  uint16_t mult;
  uint16_t div;
  char*   name;
};

int currentJob = 0;
struct PWM_Mode workCycle[] = {//{100,100,"gas50"}, {3,10,"gas15"}, 
  {100,100,"methane"}, {14, 50, "co"}
    // {100,100,"gas50"}, {14,50,"gas14"} 
    // {100,100,"gas50"}, {13,50,"gas13"},
   // {100,100,"gas50"}, {7,25,"gas14"}
   // {100,100,"gas50"}, {8,25,"gas16"}
};

#define TOTAL_JOBS (sizeof(workCycle)/sizeof(struct PWM_Mode))

inline bool isLowPower(){
  return workCycle[currentJob].mult != workCycle[currentJob].div;
}
inline int getNextJob(){
  int nextJob = currentJob + 1;
  return (nextJob < TOTAL_JOBS) ? nextJob : 0;
}
// return values:
// empty string - no valid value
// else - name of measured gas: gas50, gas15, gas14, etc
char* mq_read_designation(void){
  return previousName;
}
// pre-measured value
double mq_read_value(void){
  return previousValue;
}

static void MQ9jobLog(void *arg){
  LOG(LL_INFO, ("MQ9 set job to %i: %s (%i/%i)", currentJob, workCycle[currentJob].name, workCycle[currentJob].mult, workCycle[currentJob].div));
}

bool pm_mq9_set_job(int value){
  currentJob = value;
  // if (workCycle[currentJob].mult){
  //  mgos_gpio_write(power, 1);
  // }
  // mgos_invoke_cb(MQ9jobLog, NULL, true);
  return true;
}

int measuringJob = -1;

static void measure_timer_cb(void *arg) {
  assert(measuringJob>=0);
  bool lowPowerMode = workCycle[measuringJob].mult != workCycle[measuringJob].div;
  assert(doMeasure);
  assert(measureTimerId);
  int  mq9sum;
  bool inWindow = (lowPowerMode && timerTick >= LOW_BEGIN_MEASURE_TICK && timerTick < LOW_DUTY_TICKS) || 
    (!lowPowerMode && timerTick >= HIGH_BEGIN_MEASURE_TICK && timerTick < HIGH_DUTY_TICKS);

  if (inWindow){
    assert(samplesTop < PM_MQ9_SAMPLES);
    samples[samplesTop++] = mgos_adc_read(sense);
  }
  if (samplesTop >= PM_MQ9_SAMPLES || !inWindow){
    assert(measureTimerId);
    mgos_clear_timer(measureTimerId);
    if (!inWindow){
      LOG(LL_ERROR, ("not fit measuring window %i %i", timerTick, samplesTop));
    }
    doMeasure = false;
    measureTimerId = 0;
    mq9sum = 0;
    for(int i=0; i < samplesTop; i++ ){
      mq9sum += samples[i];
    }
    pm_mq9.co_valid = false;
    pm_mq9.methane_valid = false;
    if (samplesTop > 16){
      double gas = (double)mq9sum / (double)samplesTop * ADC2VALUE * 100.0;
      gas = round(gas) / 100.0;
      if (lowPowerMode){
        pm_mq9.co = gas;
        pm_mq9.co_valid = true;
        LOG(LL_INFO, ("Measured MQ LO%i level: %f, samples: %i", measuringJob >> 1, pm_mq9.co, samplesTop));
      }else{
        pm_mq9.methane = gas;
        pm_mq9.methane_valid = true;
        LOG(LL_INFO, ("Measured MQ HI%i level: %f, samples: %i", measuringJob >> 1, pm_mq9.methane, samplesTop));
      }
      previousValue = gas;
      previousName = workCycle[measuringJob].name;
      mgos_event_trigger(lowPowerMode ? SM_CO_AVAILABLE : SM_METHANE_AVAILABLE, (void*)NULL);
    }else{
      previousValue = -1000.0;
      previousName = "";
    }
  }
  (void) arg;
}

static void begin_measure_cb(void *arg){
  assert(doMeasure);
  assert(measureTimerId == 0);
  // clear buffer
  samplesTop = 0;
  for(int i=0; i < PM_MQ9_SAMPLES; i++ )
    samples[i] = 0;
  // LOG(LL_INFO, ("Begin MQ9 measurement, lowPower=%i", lowPowerMode));
  measureTimerId = mgos_set_timer(MEASURE_TICK_MS, MGOS_TIMER_RUN_NOW | MGOS_TIMER_REPEAT, measure_timer_cb, NULL);
}

static void pwm_hw_timer_cb(void *arg) {
  timerTick++;
  bool lowPowerMode = isLowPower();
  int rest = lowPowerMode ? timerTick % workCycle[currentJob].div : 0; 
  if (lowPowerMode){
    /*if (doMeasure){
      // do nothing
    }else */
    if (rest == workCycle[currentJob].mult){
      mgos_gpio_write(power, 0); // disable each 3th tick (30ms) - we will get 1.5V from 5V 
    }else if(rest==0){
      mgos_gpio_write(power, 1); // enable each 10th tick (100ms)
    }
    if (timerTick >= LOW_DUTY_TICKS){
      // end work cycle
      if (dualMode){
        pm_mq9_set_job(getNextJob());
      }
      timerTick = 0;
      rest = 0;
    }else if (timerTick == LOW_BEGIN_MEASURE_TICK){
      doMeasure = true;
      measuringJob = currentJob;
      // mgos_gpio_write(power, 0); // no heat while measuring
      mgos_invoke_cb(begin_measure_cb, (void *)0, true);
    }
  }else{// full power mode
    if (!doMeasure && !mgos_gpio_read_out(power)){
      mgos_gpio_write(power, 1);
    };
    if (timerTick >= HIGH_DUTY_TICKS){
      // end work cycle
      if (dualMode){
        pm_mq9_set_job(getNextJob());
      }
      timerTick = 0;
      rest = 0;
    }else if (timerTick == HIGH_BEGIN_MEASURE_TICK){
      doMeasure = true;
      measuringJob = currentJob;
      // mgos_gpio_write(power, 0); // no heat while measuring
      mgos_invoke_cb(begin_measure_cb, (void *)0, true);
    }
  }
  (void) arg;
}

bool mq_init(void){
  if (pm_mq9.initialised)
    return true;

  power = mgos_sys_config_get_mq_power();
  sense = mgos_sys_config_get_mq_sense();

  // load low power duty cycle from config
  if (TOTAL_JOBS >= 2 && strcmp(workCycle[1].name, "co")==0){
    workCycle[1].mult = mgos_sys_config_get_mq_mult();
    workCycle[1].div = mgos_sys_config_get_mq_div();
  }

  mgos_adc_enable(sense);
  esp32_set_channel_attenuation(sense, ADC_ATTEN_DB_0);
  pm_mq9.initialised = true;
  pm_mq9.methane_valid = false;
  pm_mq9.co_valid = false;

  mgos_gpio_set_mode(power, MGOS_GPIO_MODE_OUTPUT);
  mgos_gpio_write(sense, 0);  // off
  pm_mq9_set_job(0);

  mgos_set_hw_timer(HW_TICK_USEC, MGOS_TIMER_RUN_NOW | MGOS_TIMER_REPEAT, pwm_hw_timer_cb, NULL /* arg */);
  LOG(LL_INFO, ("MQ timer starts, window=%i, K=%i, jobs=%i", MEASURE_TICKS_WINDOW, K, TOTAL_JOBS));
  return true;
}

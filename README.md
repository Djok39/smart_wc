# Smart Water Closet
This device is designed to become part of a smart home.

## Features
- control light in 3 rooms via motion
- measure air quality and do automatic ventilation control
- support MQTT, mDash and easy changeable buisness logic over air, thanks mongoose os.

## Partial parts list
- SSR: g3mb-202p-dc5
- Sensors: MH-Z19b, MQ9, HC-SR501, D2FC

## Design notes
- mount PIR sensors in right places.
- PIR sensors HC-SR501 has high output impedace, so i recomend to use twisted pair for it to avoid 220v network interference.
- PIR sensors HC-SR501 has bug/feature, where you leave room, but sensor will still detect motion for some time.
- i used D2FC micro switch for closed door sensor - it is noisy a bit.
- g3mb-202p-dc5 SSR relay designed for 5v supply, but works OK with 3.3v input. Anyway, all of them - cheap chinese copy.
- UTP 5e cable with IDC connectors pretty useful for connecting sensors.
- you may need to extend gpio count, throug external IC.
- i suggest to use init.js script as main config file.
- you can replace MQ9 with MQ7 or any other MQ* sensor, but you will need pick up a load resistor, i recommend 200k for MQ7.
- MQ9-based ventilation control is definitely a bad idea. Because it will respond to all odors.
- z19b is much better suited to this role, but it is not the best CO2 sensor. I would say that it is noisy.
- ABC logic is always disabled for z19b to ensure the repeatability.
- [some connectivity schematics you will found here](docs)

## My mistakes
- too flimsy housing
- do not place motion sensors on the ceiling - they will be triggered when you walk near the room - the sensor will see your legs.
- think about design and extensibility, i.e. maybe you want to add leak detectors later, but there is no remaining pins on MCU. So GPIO expander is needed in base design.

## Installation
- please, refer to documentation, setup wi-wi, mqtt, mDash, etc. https://mongoose-os.com/docs/mongoose-os/quickstart/setup.md

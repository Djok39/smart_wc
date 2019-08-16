## Smart Water Closet
This device is designed to become part of a smart home.

# Features
- control light in 3 rooms via motion
- measure air quality and automatic ventilation control
- support MQTT, mDash and easy changeable buisness logic over air, thanks mongoose os.

# Design notes
- mount PIR sensors in right places.
- PIR sensors HC-SR501 has high output impedace, so i recomend to use twisted pair for it to avoid 220v network interference.
- PIR sensors HC-SR501 has bug/feature, where you leave room, but sensor will still detect motion for some time.
- g3mb-202p-dc5 SSR relay designed for 5v supply, but works OK with 3.3v input. Anyway, all of them - cheap chinese copy.
- UTP 5e cable with IDC connectors pretty useful.
- you may need to extend gpio count, throug external IC.
- i suggest to use init.js script as main config file.
- you can replace MQ9 with MQ7 or any other MQ* sensor, but you will need another load resistor, i recommend 200k for MQ7.
- MQ9-based ventilation control is definitely a bad idea. Because it will respond to all odors.
- z19b is much better suited to this role, but it is not the best CO2 sensor. I would say that it is noisy.
- ABC logic is always disabled for z19b to ensure the repeatability.
- [some connectivity schematics you will found here](docs)

# insallation
- please, refer to documentation, setup wi-wi, mqtt, mDash, etc. https://mongoose-os.com/docs/mongoose-os/quickstart/setup.md

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::{env, error::Error};

fn virtual_key(command: &str) -> Option<u16> {
    match command {
        "play-pause" => Some(0xB3), // VK_MEDIA_PLAY_PAUSE
        "previous" => Some(0xB1),   // VK_MEDIA_PREV_TRACK
        "next" => Some(0xB0),       // VK_MEDIA_NEXT_TRACK
        "stop" => Some(0xB2),       // VK_MEDIA_STOP
        "mute" => Some(0xAD),       // VK_VOLUME_MUTE
        "volume-down" => Some(0xAE),// VK_VOLUME_DOWN
        "volume-up" => Some(0xAF),  // VK_VOLUME_UP
        _ => None,
    }
}

fn parse_args() -> Result<(u16, usize), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or("Usage: media-keys <command> [count]")?;
    let vk = virtual_key(&command).ok_or("Unknown media command")?;
    let count_str = args.next().unwrap_or_else(|| "1".to_owned());
    if args.next().is_some() {
        return Err("Too many arguments".into());
    }
    let count: usize = count_str.parse()?;
    if !(1..=32).contains(&count) {
        return Err("Count must be between 1 and 32".into());
    }
    Ok((vk, count))
}

#[cfg(windows)]
mod win32 {
    use std::{io, mem::size_of};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        vk: u16,
        scan: u16,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct HardwareInput {
        msg: u32,
        param_l: u16,
        param_h: u16,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    union InputData {
        mouse: MouseInput,
        keyboard: KeyboardInput,
        hardware: HardwareInput,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Input {
        kind: u32,
        data: InputData,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
    }

    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    fn key_input(vk: u16, key_up: bool) -> Input {
        Input {
            kind: INPUT_KEYBOARD,
            data: InputData {
                keyboard: KeyboardInput {
                    vk,
                    scan: 0,
                    flags: if key_up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    extra_info: 0,
                },
            },
        }
    }

    pub fn send_key(vk: u16, count: usize) -> io::Result<()> {
        // SendInput's INPUT layout contains the full Win32 union; using
        // KeyboardInput alone would produce the wrong cbSize on 64-bit Windows.
        for _ in 0..count {
            let events = [key_input(vk, false), key_input(vk, true)];
            let written = unsafe { SendInput(2, events.as_ptr(), size_of::<Input>() as i32) };
            if written != 2 {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(())
    }

    #[cfg(test)]
    #[test]
    fn win32_input_size_is_correct() {
        assert_eq!(size_of::<Input>(), if cfg!(target_pointer_width = "64") { 40 } else { 28 });
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let (vk, count) = parse_args()?;
    #[cfg(windows)]
    {
        win32::send_key(vk, count)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (vk, count);
        Err("This helper supports Windows only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn media_keys_are_mapped() {
        for name in ["play-pause", "previous", "next", "stop", "mute", "volume-up", "volume-down"] {
            assert!(virtual_key(name).is_some());
        }
        assert!(virtual_key("unknown").is_none());
    }
}

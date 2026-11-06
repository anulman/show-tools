#pragma once
#include <stddef.h>
typedef struct snd_pcm_t snd_pcm_t;
typedef struct snd_pcm_hw_params_t snd_pcm_hw_params_t;
typedef long snd_pcm_sframes_t;
typedef unsigned long snd_pcm_uframes_t;
enum { SND_PCM_STREAM_CAPTURE, SND_PCM_STREAM_PLAYBACK, SND_PCM_ACCESS_RW_INTERLEAVED, SND_PCM_FORMAT_S32_LE, SND_PCM_FORMAT_FLOAT_LE };
int snd_pcm_open(snd_pcm_t**, const char*, int, int);
int snd_pcm_close(snd_pcm_t*);
int snd_pcm_hw_params_malloc(snd_pcm_hw_params_t**);
void snd_pcm_hw_params_free(snd_pcm_hw_params_t*);
int snd_pcm_hw_params_any(snd_pcm_t*, snd_pcm_hw_params_t*);
int snd_pcm_hw_params_set_rate_resample(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned);
int snd_pcm_hw_params_set_access(snd_pcm_t*, snd_pcm_hw_params_t*, int);
int snd_pcm_hw_params_set_format(snd_pcm_t*, snd_pcm_hw_params_t*, int);
int snd_pcm_hw_params_set_channels(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned);
int snd_pcm_hw_params_set_rate(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned, int);
int snd_pcm_hw_params_set_period_size(snd_pcm_t*, snd_pcm_hw_params_t*, snd_pcm_uframes_t, int);
int snd_pcm_hw_params_set_buffer_size(snd_pcm_t*, snd_pcm_hw_params_t*, snd_pcm_uframes_t);
int snd_pcm_hw_params(snd_pcm_t*, snd_pcm_hw_params_t*);
snd_pcm_sframes_t snd_pcm_readi(snd_pcm_t*, void*, snd_pcm_uframes_t);
snd_pcm_sframes_t snd_pcm_writei(snd_pcm_t*, const void*, snd_pcm_uframes_t);
int snd_pcm_recover(snd_pcm_t*, int, int);
int snd_pcm_drop(snd_pcm_t*);
int snd_pcm_prepare(snd_pcm_t*);
const char* snd_strerror(int);

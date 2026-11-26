'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LocateFixed, MapPin } from 'lucide-react'
import { mapLink, validPoint, type DeliveryPoint } from '../lib/delivery'
import styles from './delivery-fields.module.css'

export default function DeliveryFields({ required = true }: { required?: boolean }) {
  const [point, setPoint] = useState<DeliveryPoint | null>(null)
  const [status, setStatus] = useState('Sedang mencari lokasi…')
  const [pending, setPending] = useState(true)
  const [accuracy, setAccuracy] = useState(0)
  const sequence = useRef(0)

  const locate = useCallback(() => {
    const attempt = ++sequence.current
    setPoint(null)
    setPending(true)
    setStatus('Sedang mencari lokasi…')
    function fail(message: string) {
      if (sequence.current !== attempt) return
      setStatus(message)
      setPending(false)
    }
    if (!navigator.geolocation) return fail('Browser ini belum mendukung lokasi. Isi alamat di bawah.')
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (sequence.current !== attempt) return
        const {latitude, longitude, accuracy} = position.coords
        if (!validPoint({latitude, longitude})) return fail('Lokasi belum tersedia. Isi alamat secara manual.')
        setPoint({latitude, longitude})
        setAccuracy(Math.ceil(accuracy))
        setStatus('Titik antar ditemukan')
        setPending(false)
      }, error => fail(error.code === 1 ? 'Izin lokasi ditolak. Kamu tetap bisa mengisi alamat.' : 'Lokasi belum ditemukan. Coba lagi atau isi alamat.'), {enableHighAccuracy:true, timeout:12000, maximumAge:0})
    } catch {
      fail('Lokasi tidak tersedia. Kamu tetap bisa mengisi alamat.')
    }
  }, [])
  useEffect(() => {
    locate()
    return () => { sequence.current++ }
  }, [locate])

  function manual() {
    sequence.current++
    setPoint(null)
    setPending(false)
    setStatus('Menggunakan alamat manual')
  }
  return <section className={styles.destination} aria-label="Tujuan pengantaran">
    <div className={styles.title}><MapPin size={21} aria-hidden="true"/> Tujuan pengantaran</div>
    <div role="status" aria-live="polite"><strong>{status}</strong>{point && accuracy > 0 && <span> · akurasi sekitar {accuracy} m</span>}</div>
    <p>{point ? 'Periksa titik sebelum memesan. Titik ini ikut dikirim ke warung bersama pesanan.' : 'Izinkan lokasi jika pesanan diantar ke tempatmu sekarang.'}</p>
    <div className={styles.actions}>
      {point && <a href={mapLink(point)} target="_blank" rel="noreferrer">Lihat titik di peta</a>}
      {!pending && <button type="button" onClick={locate}><LocateFixed size={16} aria-hidden="true"/>{point?'Perbarui titik':'Cari lokasi saya'}</button>}
      {(point || pending) && <button type="button" onClick={manual}>Pakai alamat manual</button>}
    </div>
    {point && <><input type="hidden" name="latitude" value={point.latitude}/><input type="hidden" name="longitude" value={point.longitude}/></>}
    <label>{point?'Detail alamat atau patokan (opsional)':'Alamat lengkap'}<textarea name="address" autoComplete="street-address" required={required && !point} maxLength={300} placeholder="Nama jalan, nomor rumah, atau patokan"/></label>
  </section>
}

insert into public.verified_sources (domain, display_name, country, subject, tier, weight) values
-- Sundhed
('pubmed.ncbi.nlm.nih.gov','PubMed','INT','health','A',1.0),
('cochranelibrary.com','Cochrane Library','INT','health','A',1.0),
('who.int','WHO','INT','health','A',1.0),
('ema.europa.eu','EMA','EU','health','A',1.0),
('sst.dk','Sundhedsstyrelsen','DK','health','A',1.0),
('ssi.dk','Statens Serum Institut','DK','health','A',1.0),
('sundhed.dk','Sundhed.dk','DK','health','B',0.6),

-- Lov/forvaltning
('retsinformation.dk','Retsinformation','DK','law','A',1.0),
('borger.dk','Borger.dk','DK','law','B',0.6),
('fm.dk','Finansministeriet','DK','law','B',0.6),
('europa.eu','EU portals','EU','law','A',1.0),

-- Statistik/økonomi
('dst.dk','Danmarks Statistik','DK','stats','A',1.0),
('eurostat.ec.europa.eu','Eurostat','EU','stats','A',1.0),
('oecd.org','OECD','INT','stats','A',1.0),
('imf.org','IMF','INT','economics','B',0.6),
('worldbank.org','World Bank','INT','economics','B',0.6),

-- Uddannelse/forskning
('ku.dk','Københavns Universitet','DK','education','B',0.6),
('au.dk','Aarhus Universitet','DK','education','B',0.6),
('aau.dk','Aalborg Universitet','DK','education','B',0.6),
('sdu.dk','Syddansk Universitet','DK','education','B',0.6),
('nature.com','Nature','INT','science','B',0.6),
('sciencedirect.com','ScienceDirect','INT','science','B',0.6),

-- Standarder/teknik
('iso.org','ISO','INT','standards','B',0.6),
('ds.dk','Dansk Standard','DK','standards','B',0.6),

-- Baggrund
('wikipedia.org','Wikipedia','INT','background','C',0.3)
on conflict (domain) do update set
  display_name=excluded.display_name,
  country=excluded.country,
  subject=excluded.subject,
  tier=excluded.tier,
  weight=excluded.weight,
  active=true,
  updated_at=now();
